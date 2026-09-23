'use client';

import { useCallback, useEffect, useState } from 'react';
import { useCategories } from '@/hooks/useCategories';

const PAYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'credit', label: 'Crédito' },
  { value: 'debit', label: 'Débito' },
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'food-voucher', label: 'Vale Alimentação' },
  { value: 'meal-voucher', label: 'Vale Refeição' },
  { value: 'fuel-voucher', label: 'Vale Combustível' },
];

const CARD_BRANDS = ['Master Santander', 'Visa Caixa', 'Elo Caixa'];

interface PluggyTransactionRow {
  _id: string;
  pluggyId: string;
  accountId: string;
  date: string;
  amount: number;
  description: string;
  merchantName?: string;
  pluggyStatus: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  direction?: 'outflow' | 'inflow';
  paymentType?: string;
  cardBrand?: string;
  status: 'pending' | 'imported' | 'ignored' | 'skipped_existing' | 'anomaly';
  statusReason?: string;
  suggestedType?: string;
  suggestedSubtype?: string;
}

type ExpenseRowState = PluggyTransactionRow & {
  resolvedType: string | null;
  resolvedSubtype: string | null;
  resolvedPaymentType: string;
  resolvedCardBrand: string;
};

type IncomeRowState = PluggyTransactionRow & {
  resolvedType: string | null;
};

function fmt(v: number) {
  return Math.abs(v).toLocaleString('pt-BR', { minimumFractionDigits: 2 });
}

function displayDate(date: string) {
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('pt-BR', { timeZone: 'UTC' });
}

async function fetchTransactions(status: string): Promise<PluggyTransactionRow[]> {
  const res = await fetch(`/api/pluggy/transactions?status=${status}&limit=500`);
  if (!res.ok) throw new Error(`GET /api/pluggy/transactions?status=${status} failed: ${res.status}`);
  const data = await res.json();
  return (data.items ?? []) as PluggyTransactionRow[];
}

// The POST /api/pluggy/sync envelope (RunPluggySyncResult in pluggyService).
interface SyncResponse {
  sync?: {
    accounts?: { accountId: string; fetched: number; created: number; anomalies: number; error?: string }[];
    items?: { itemId: string; status: string }[];
  };
  autoImport?: {
    expensesImported: number;
    incomesImported: number;
    stillPending: number;
    skippedExisting: number;
  };
}

// A sync that reads nothing looks identical to a sync with no new
// transactions unless the counts are shown: an account left disabled in
// "Sincronizar agora" PATCHes every item first, which starts an ASYNCHRONOUS
// Pluggy refresh, and syncAllAccounts reads the status back immediately after
// — so UPDATING is the normal outcome of a healthy manual sync, not a problem.
// Warning on it would fire on every run and train the user to ignore the very
// notice that exists to surface a real LOGIN_ERROR. WAITING_USER_INPUT is
// likewise the connector asking for an MFA code in the Pluggy widget.
const HEALTHY_ITEM_STATUSES = new Set(['UPDATED', 'UPDATING', 'WAITING_USER_INPUT']);

// "Configurar Pluggy" is never fetched (syncAllAccounts filters on
// `enabled: true`), and an item in LOGIN_ERROR silently returns no rows. Both
// are configuration problems the user can only act on if the screen names
// them, so the notice reports accounts synced / rows fetched and calls out an
// unhealthy item by name. A per-account failure is the caller's to surface —
// it goes in the error banner, not here.
function describeSync(data: SyncResponse): string {
  const accounts = data.sync?.accounts ?? [];
  const items = data.sync?.items ?? [];
  const lines: string[] = [];

  if (accounts.length === 0) {
    lines.push(
      'Nenhuma conta habilitada — nada foi lido. Habilite as contas em "Configurar Pluggy" (marque "Habilitada" e salve cada conta).'
    );
  } else {
    const fetched = accounts.reduce((sum, a) => sum + a.fetched, 0);
    const created = accounts.reduce((sum, a) => sum + a.created, 0);
    const anomalies = accounts.reduce((sum, a) => sum + a.anomalies, 0);
    lines.push(
      `Sincronização concluída · ${accounts.length} ${accounts.length === 1 ? 'conta' : 'contas'} · ` +
        `${fetched} ${fetched === 1 ? 'transação lida' : 'transações lidas'}, ${created} ${created === 1 ? 'nova' : 'novas'}` +
        (anomalies > 0 ? `, ${anomalies} ${anomalies === 1 ? 'anomalia' : 'anomalias'}` : '')
    );

    if (data.autoImport) {
      const { expensesImported, incomesImported, stillPending, skippedExisting } = data.autoImport;
      const imported = expensesImported + incomesImported;
      lines.push(
        `${imported} ${imported === 1 ? 'transação importada' : 'transações importadas'} automaticamente · ` +
          `${stillPending} aguardando revisão` +
          (skippedExisting > 0 ? ` · ${skippedExisting} já existiam` : '')
      );
    }
  }

  for (const item of items) {
    if (!HEALTHY_ITEM_STATUSES.has(item.status)) lines.push(`⚠ Conexão ${item.itemId}: ${item.status}`);
  }

  return lines.join('\n');
}

export default function PluggySync({ onDone }: { onDone: () => void }) {
  const {
    expenseTypes,
    incomeTypes,
    subtypesFor,
    isValidType,
    isValidPair,
    loading: categoriesLoading,
  } = useCategories();

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [importingExpenses, setImportingExpenses] = useState(false);
  const [importingIncomes, setImportingIncomes] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [expenseRows, setExpenseRows] = useState<ExpenseRowState[]>([]);
  const [incomeRows, setIncomeRows] = useState<IncomeRowState[]>([]);
  const [ignoredRows, setIgnoredRows] = useState<PluggyTransactionRow[]>([]);
  const [anomalyRows, setAnomalyRows] = useState<PluggyTransactionRow[]>([]);
  const [ignoredExpanded, setIgnoredExpanded] = useState(false);
  const [anomaliesExpanded, setAnomaliesExpanded] = useState(false);

  const [selectedExpenseIds, setSelectedExpenseIds] = useState<Set<string>>(new Set());
  const [selectedIncomeIds, setSelectedIncomeIds] = useState<Set<string>>(new Set());

  // A category renamed or deleted elsewhere leaves a staged row's suggestion
  // pointing at a name that no longer exists; treat it as unclassified rather
  // than importing an orphan — same rule ImportBill follows.
  const effectiveType = (type: string | null): string | null =>
    type !== null && (categoriesLoading || isValidType(type)) ? type : null;

  const effectiveSubtype = (type: string | null, subtype: string | null): string | null =>
    type !== null && subtype !== null && (categoriesLoading || isValidPair(type, subtype))
      ? subtype
      : null;

  const effectiveIncomeType = (type: string | null): string | null =>
    type !== null && (categoriesLoading || incomeTypes.includes(type)) ? type : null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [pending, ignored, anomalies] = await Promise.all([
        fetchTransactions('pending'),
        fetchTransactions('ignored'),
        fetchTransactions('anomaly'),
      ]);
      setExpenseRows(
        pending
          .filter(r => r.direction === 'outflow')
          .map(r => ({
            ...r,
            resolvedType: r.suggestedType ?? null,
            resolvedSubtype: r.suggestedSubtype ?? null,
            resolvedPaymentType: r.paymentType ?? 'debit',
            resolvedCardBrand: r.cardBrand ?? '',
          }))
      );
      setIncomeRows(
        pending.filter(r => r.direction === 'inflow').map(r => ({ ...r, resolvedType: null }))
      );
      setIgnoredRows(ignored);
      setAnomalyRows(anomalies);
      setSelectedExpenseIds(new Set());
      setSelectedIncomeIds(new Set());
    } catch {
      setError('Erro ao carregar transações Pluggy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const updateExpenseRow = <K extends keyof ExpenseRowState>(
    pluggyId: string,
    field: K,
    value: ExpenseRowState[K]
  ) => {
    setExpenseRows(prev =>
      prev.map(row => {
        if (row.pluggyId !== pluggyId) return row;
        const updated = { ...row, [field]: value };
        if (field === 'resolvedType') updated.resolvedSubtype = null;
        if (field === 'resolvedPaymentType' && value !== 'credit') updated.resolvedCardBrand = '';
        return updated;
      })
    );
  };

  const updateIncomeRow = (pluggyId: string, type: string | null) => {
    setIncomeRows(prev => prev.map(row => (row.pluggyId === pluggyId ? { ...row, resolvedType: type } : row)));
  };

  const toggleExpenseSelected = (pluggyId: string, checked: boolean) => {
    setSelectedExpenseIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(pluggyId);
      else next.delete(pluggyId);
      return next;
    });
  };

  const toggleIncomeSelected = (pluggyId: string, checked: boolean) => {
    setSelectedIncomeIds(prev => {
      const next = new Set(prev);
      if (checked) next.add(pluggyId);
      else next.delete(pluggyId);
      return next;
    });
  };

  const allExpensesSelected = expenseRows.length > 0 && expenseRows.every(r => selectedExpenseIds.has(r.pluggyId));
  const someExpensesSelected = selectedExpenseIds.size > 0 && selectedExpenseIds.size < expenseRows.length;
  // A callback ref rather than a single useRef: the md+ header checkbox and the
  // mobile "Selecionar todos" checkbox are two separate nodes, and a partial
  // selection has to read as partial on both.
  const selectAllExpensesRef = useCallback(
    (el: HTMLInputElement | null) => { if (el) el.indeterminate = someExpensesSelected; },
    [someExpensesSelected]
  );

  const allIncomesSelected = incomeRows.length > 0 && incomeRows.every(r => selectedIncomeIds.has(r.pluggyId));
  const someIncomesSelected = selectedIncomeIds.size > 0 && selectedIncomeIds.size < incomeRows.length;
  const selectAllIncomesRef = useCallback(
    (el: HTMLInputElement | null) => { if (el) el.indeterminate = someIncomesSelected; },
    [someIncomesSelected]
  );

  const selectAllExpenses = (checked: boolean) =>
    setSelectedExpenseIds(checked ? new Set(expenseRows.map(r => r.pluggyId)) : new Set());
  const selectAllIncomes = (checked: boolean) =>
    setSelectedIncomeIds(checked ? new Set(incomeRows.map(r => r.pluggyId)) : new Set());

  const handleSync = async () => {
    setSyncing(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/pluggy/sync', { method: 'POST' });
      const data: SyncResponse = await res.json();
      if (!res.ok) {
        setError((data as { error?: string }).error ?? 'Erro ao sincronizar com a Pluggy');
        return;
      }
      // A per-account failure comes back inside a 200 body (one bank must not
      // stop the others), so an outage that hits every account — a Pluggy
      // endpoint deprecation answering 410 — otherwise renders as a clean
      // sync that imported nothing. It goes in the error banner rather than
      // the notice, which `data.error` alone (set on non-OK responses only)
      // would never carry; describeSync still reports what DID sync.
      const failed: { error?: string }[] =
        (data.sync?.accounts ?? []).filter((a: { error?: string }) => a.error);

      if (failed.length) {
        setError(
          `Falha ao sincronizar ${failed.length} ${failed.length === 1 ? 'conta' : 'contas'}: ` +
            `${failed[0].error}`
        );
      }
      setNotice(describeSync(data));
      await load();
    } catch {
      setError('Erro de rede ao sincronizar com a Pluggy');
    } finally {
      setSyncing(false);
    }
  };

  const handleUnignore = async (pluggyId: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/pluggy/transactions/${encodeURIComponent(pluggyId)}`, { method: 'PATCH' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Erro ao reverter transação ignorada');
        return;
      }
      await load();
    } catch {
      setError('Erro de rede ao reverter transação ignorada');
    }
  };

  const handleConfirmExpenses = async () => {
    const subset = expenseRows.filter(r => selectedExpenseIds.has(r.pluggyId));
    const resolved = subset.map(row => {
      const type = effectiveType(row.resolvedType);
      const subtype = effectiveSubtype(type, row.resolvedSubtype);
      const paymentReady = row.resolvedPaymentType !== 'credit' || row.resolvedCardBrand !== '';
      return { row, type, subtype, paymentReady };
    });
    const ready = resolved.filter(r => r.type !== null && r.paymentReady);
    if (ready.length === 0) {
      // Silently doing nothing on a click is indistinguishable from a broken
      // button: say which gate rejected the selection.
      const noType = resolved.filter(r => r.type === null).length;
      const noCard = resolved.filter(r => r.type !== null && !r.paymentReady).length;
      setNotice(null);
      setError(
        noCard > 0 && noType === 0
          ? 'Nenhum gasto importado: selecione a bandeira do cartão nas linhas de crédito.'
          : 'Nenhum gasto importado: as linhas selecionadas precisam de uma categoria válida (e da bandeira, no crédito).'
      );
      return;
    }

    // Compare against the *effective* suggested values from the staged row,
    // never the raw parsed state — an orphaned suggestion the user never
    // touched must not look edited and overwrite the BillMapping with null.
    const items = ready.map(({ row, type, subtype }) => {
      const suggestedType = effectiveType(row.suggestedType ?? null);
      const suggestedSubtype = effectiveSubtype(suggestedType, row.suggestedSubtype ?? null);
      const newMapping = type !== suggestedType || subtype !== suggestedSubtype;
      return {
        pluggyId: row.pluggyId,
        kind: 'expense' as const,
        type: type!,
        ...(subtype !== null && { subtype }),
        paymentType: row.resolvedPaymentType,
        ...(row.resolvedPaymentType === 'credit' && { cardBrand: row.resolvedCardBrand }),
        newMapping,
      };
    });

    setImportingExpenses(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/pluggy/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao importar transações');
        return;
      }
      setNotice(
        `${data.imported} ${data.imported === 1 ? 'gasto importado' : 'gastos importados'}.` +
        (data.skippedExisting > 0 ? ` ${data.skippedExisting} já existente(s).` : '')
      );
      await load();
    } catch {
      setError('Erro de rede ao importar transações');
    } finally {
      setImportingExpenses(false);
    }
  };

  const handleConfirmIncomes = async () => {
    const subset = incomeRows.filter(r => selectedIncomeIds.has(r.pluggyId));
    const resolved = subset.map(row => ({ row, type: effectiveIncomeType(row.resolvedType) }));
    const ready = resolved.filter(r => r.type !== null);
    if (ready.length === 0) return;

    const items = ready.map(({ row, type }) => ({
      pluggyId: row.pluggyId,
      kind: 'income' as const,
      type: type!,
    }));

    setImportingIncomes(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/pluggy/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao importar receitas');
        return;
      }
      setNotice(`${data.imported} ${data.imported === 1 ? 'receita importada' : 'receitas importadas'}.`);
      await load();
    } catch {
      setError('Erro de rede ao importar receitas');
    } finally {
      setImportingIncomes(false);
    }
  };

  const unclassifiedExpenses = expenseRows.filter(r => effectiveType(r.resolvedType) === null).length;
  // A credit row with no cardBrand is dropped by the same confirm gate as an
  // unclassified one, so it needs the same up-front warning — otherwise the
  // row looks ready and simply fails to import.
  const expensesMissingCardBrand = expenseRows.filter(
    r => r.resolvedPaymentType === 'credit' && r.resolvedCardBrand === ''
  ).length;
  const unclassifiedIncomes = incomeRows.filter(r => effectiveIncomeType(r.resolvedType) === null).length;

  const renderExpenseRow = (row: ExpenseRowState) => {
    const type = effectiveType(row.resolvedType);
    const subtype = effectiveSubtype(type, row.resolvedSubtype);
    const typeOrphaned = type === null && row.resolvedType !== null;
    const subtypeOrphaned = subtype === null && type !== null && row.resolvedSubtype !== null;
    const subtypes = type ? [...subtypesFor(type)].sort() : [];
    const needsCardBrand = row.resolvedPaymentType === 'credit' && !row.resolvedCardBrand;

    return {
      row,
      checkbox: (
        <input
          type="checkbox"
          checked={selectedExpenseIds.has(row.pluggyId)}
          onChange={e => toggleExpenseSelected(row.pluggyId, e.target.checked)}
        />
      ),
      date: displayDate(row.date),
      // A PENDING row is still mutable at the bank: its amount can change and
      // it can vanish entirely, which is why autoImportStaged never touches
      // one. It is importable by hand, so the flag has to be visible — and it
      // goes on `description` because both breakpoints (the md:table row and
      // the mobile card) render this same value.
      description: (
        <>
          {row.pluggyStatus === 'PENDING' && (
            <span
              title="Lançamento ainda não consolidado pelo banco — valor e data podem mudar."
              className="mr-1 inline-block rounded bg-amber-200 px-1 text-[10px] font-bold text-amber-900 align-middle"
            >
              PENDENTE
            </span>
          )}
          {row.description}
        </>
      ),
      installment: row.installmentCurrent !== undefined && row.installmentTotal !== undefined
        ? `${row.installmentCurrent}/${row.installmentTotal}`
        : '—',
      typeSelect: (
        <>
          <select
            value={type ?? ''}
            onChange={e => updateExpenseRow(row.pluggyId, 'resolvedType', e.target.value === '' ? null : e.target.value)}
            className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white"
          >
            <option value="">Selecione...</option>
            {[...expenseTypes].sort().map(t => (<option key={t} value={t}>{t}</option>))}
          </select>
          {typeOrphaned && (
            <p className="text-[10px] text-amber-700 mt-0.5">⚠ &ldquo;{row.resolvedType}&rdquo; não existe mais</p>
          )}
        </>
      ),
      subtypeSelect: (
        <>
          <select
            value={subtype ?? ''}
            onChange={e => updateExpenseRow(row.pluggyId, 'resolvedSubtype', e.target.value === '' ? null : e.target.value)}
            disabled={!type}
            className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white disabled:opacity-40"
          >
            <option value="">Selecione...</option>
            {subtypes.map(s => (<option key={s} value={s}>{s}</option>))}
          </select>
          {subtypeOrphaned && (
            <p className="text-[10px] text-amber-700 mt-0.5">⚠ &ldquo;{row.resolvedSubtype}&rdquo; não existe mais</p>
          )}
        </>
      ),
      paymentSelect: (
        <>
          <select
            value={row.resolvedPaymentType}
            onChange={e => updateExpenseRow(row.pluggyId, 'resolvedPaymentType', e.target.value)}
            className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white"
          >
            {PAYMENT_TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
          </select>
          {row.resolvedPaymentType === 'credit' && (
            <select
              value={row.resolvedCardBrand}
              onChange={e => updateExpenseRow(row.pluggyId, 'resolvedCardBrand', e.target.value)}
              className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white mt-1"
            >
              <option value="">Cartão...</option>
              {CARD_BRANDS.map(b => (<option key={b} value={b}>{b}</option>))}
            </select>
          )}
          {needsCardBrand && (
            <p className="text-[10px] text-amber-700 mt-0.5">⚠ cartão obrigatório</p>
          )}
        </>
      ),
      value: `R$ ${fmt(row.amount)}`,
    };
  };

  return (
    <div className="max-w-6xl mx-auto p-3 sm:p-4 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold">Sincronizar Pluggy</h1>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="py-2 px-4 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
        >
          {syncing ? 'Sincronizando...' : 'Sincronizar agora'}
        </button>
      </div>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}
      {notice && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded px-3 py-2 whitespace-pre-line">
          {notice}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-gray-400">Carregando transações...</p>
      ) : (
        <>
          {/* Pending expenses */}
          <section>
            <h2 className="text-base font-bold mb-2">Gastos pendentes ({expenseRows.length})</h2>
            {expenseRows.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhum gasto pendente de revisão.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="hidden md:table w-full min-w-[900px] text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-left">
                        <th className="p-2 border border-gray-200 w-8 text-center">
                          <input
                            type="checkbox"
                            ref={selectAllExpensesRef}
                            checked={allExpensesSelected}
                            onChange={e => selectAllExpenses(e.target.checked)}
                          />
                        </th>
                        <th className="p-2 border border-gray-200 whitespace-nowrap">Data</th>
                        <th className="p-2 border border-gray-200">Descrição</th>
                        <th className="p-2 border border-gray-200 whitespace-nowrap">Parcela</th>
                        <th className="p-2 border border-gray-200">Categoria</th>
                        <th className="p-2 border border-gray-200">Subcategoria</th>
                        <th className="p-2 border border-gray-200">Pagamento</th>
                        <th className="p-2 border border-gray-200 text-right whitespace-nowrap">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {expenseRows.map(row => {
                        const r = renderExpenseRow(row);
                        return (
                          <tr key={row.pluggyId} className={effectiveType(row.resolvedType) !== null ? 'bg-green-50' : 'bg-amber-50'}>
                            <td className="p-1.5 border border-gray-200 text-center">{r.checkbox}</td>
                            <td className="p-1.5 border border-gray-200 whitespace-nowrap text-xs text-gray-600">{r.date}</td>
                            <td className="p-1.5 border border-gray-200 text-xs">{r.description}</td>
                            <td className="p-1.5 border border-gray-200 text-xs text-center whitespace-nowrap text-gray-600">{r.installment}</td>
                            <td className="p-1.5 border border-gray-200">{r.typeSelect}</td>
                            <td className="p-1.5 border border-gray-200">{r.subtypeSelect}</td>
                            <td className="p-1.5 border border-gray-200">{r.paymentSelect}</td>
                            <td className="p-1.5 border border-gray-200 text-right text-xs whitespace-nowrap">{r.value}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Below md the same rows render as cards. */}
                <ul className="md:hidden divide-y divide-gray-200 border rounded-lg overflow-hidden">
                  <li className="flex items-center gap-3 px-3 py-2 bg-gray-50">
                    <input
                      type="checkbox"
                      ref={selectAllExpensesRef}
                      className="h-4 w-4"
                      checked={allExpensesSelected}
                      onChange={e => selectAllExpenses(e.target.checked)}
                    />
                    <span className="text-xs font-bold text-gray-500 uppercase">Selecionar todos</span>
                  </li>
                  {expenseRows.map(row => {
                    const r = renderExpenseRow(row);
                    return (
                      <li key={row.pluggyId} className={`flex gap-3 p-3 ${effectiveType(row.resolvedType) !== null ? 'bg-green-50' : 'bg-amber-50'}`}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={selectedExpenseIds.has(row.pluggyId)}
                          onChange={e => toggleExpenseSelected(row.pluggyId, e.target.checked)}
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-900 break-words">{r.description}</span>
                            <span className="text-sm font-black text-gray-900 tabular-nums shrink-0">{r.value}</span>
                          </div>
                          <p className="text-xs text-gray-500">{r.date} · parcela {r.installment}</p>
                          {r.typeSelect}
                          {r.subtypeSelect}
                          {r.paymentSelect}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {unclassifiedExpenses > 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
                ⚠ {unclassifiedExpenses} {unclassifiedExpenses === 1 ? 'gasto sem categoria válida' : 'gastos sem categoria válida'} — {unclassifiedExpenses === 1 ? 'não será importado' : 'não serão importados'}.
              </p>
            )}

            {expensesMissingCardBrand > 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
                ⚠ {expensesMissingCardBrand} {expensesMissingCardBrand === 1 ? 'gasto no crédito sem bandeira' : 'gastos no crédito sem bandeira'} — {expensesMissingCardBrand === 1 ? 'não será importado' : 'não serão importados'} até você escolher o cartão.
              </p>
            )}

            {expenseRows.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={handleConfirmExpenses}
                  disabled={importingExpenses || categoriesLoading || selectedExpenseIds.size === 0}
                  className="py-2 px-4 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importingExpenses ? 'Importando...' : `Confirmar selecionados (${selectedExpenseIds.size})`}
                </button>
              </div>
            )}
          </section>

          {/* Pending incomes */}
          <section>
            <h2 className="text-base font-bold mb-2">Receitas pendentes ({incomeRows.length})</h2>
            {incomeRows.length === 0 ? (
              <p className="text-sm text-gray-400">Nenhuma receita pendente de revisão.</p>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="hidden md:table w-full min-w-[600px] text-sm border-collapse">
                    <thead>
                      <tr className="bg-gray-100 text-left">
                        <th className="p-2 border border-gray-200 w-8 text-center">
                          <input
                            type="checkbox"
                            ref={selectAllIncomesRef}
                            checked={allIncomesSelected}
                            onChange={e => selectAllIncomes(e.target.checked)}
                          />
                        </th>
                        <th className="p-2 border border-gray-200 whitespace-nowrap">Data</th>
                        <th className="p-2 border border-gray-200">Descrição</th>
                        <th className="p-2 border border-gray-200">Tipo</th>
                        <th className="p-2 border border-gray-200 text-right whitespace-nowrap">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {incomeRows.map(row => {
                        const type = effectiveIncomeType(row.resolvedType);
                        const orphaned = type === null && row.resolvedType !== null;
                        return (
                          <tr key={row.pluggyId} className={type !== null ? 'bg-green-50' : 'bg-amber-50'}>
                            <td className="p-1.5 border border-gray-200 text-center">
                              <input
                                type="checkbox"
                                checked={selectedIncomeIds.has(row.pluggyId)}
                                onChange={e => toggleIncomeSelected(row.pluggyId, e.target.checked)}
                              />
                            </td>
                            <td className="p-1.5 border border-gray-200 whitespace-nowrap text-xs text-gray-600">{displayDate(row.date)}</td>
                            <td className="p-1.5 border border-gray-200 text-xs">{row.description}</td>
                            <td className="p-1.5 border border-gray-200">
                              <select
                                value={type ?? ''}
                                onChange={e => updateIncomeRow(row.pluggyId, e.target.value === '' ? null : e.target.value)}
                                className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white"
                              >
                                <option value="">Selecione...</option>
                                {[...incomeTypes].sort().map(t => (<option key={t} value={t}>{t}</option>))}
                              </select>
                              {orphaned && (
                                <p className="text-[10px] text-amber-700 mt-0.5">⚠ &ldquo;{row.resolvedType}&rdquo; não existe mais</p>
                              )}
                            </td>
                            <td className="p-1.5 border border-gray-200 text-right text-xs whitespace-nowrap">R$ {fmt(row.amount)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ul className="md:hidden divide-y divide-gray-200 border rounded-lg overflow-hidden">
                  <li className="flex items-center gap-3 px-3 py-2 bg-gray-50">
                    <input
                      type="checkbox"
                      ref={selectAllIncomesRef}
                      className="h-4 w-4"
                      checked={allIncomesSelected}
                      onChange={e => selectAllIncomes(e.target.checked)}
                    />
                    <span className="text-xs font-bold text-gray-500 uppercase">Selecionar todos</span>
                  </li>
                  {incomeRows.map(row => {
                    const type = effectiveIncomeType(row.resolvedType);
                    return (
                      <li key={row.pluggyId} className={`flex gap-3 p-3 ${type !== null ? 'bg-green-50' : 'bg-amber-50'}`}>
                        <input
                          type="checkbox"
                          className="mt-1 h-4 w-4 shrink-0"
                          checked={selectedIncomeIds.has(row.pluggyId)}
                          onChange={e => toggleIncomeSelected(row.pluggyId, e.target.checked)}
                        />
                        <div className="min-w-0 flex-1 space-y-1.5">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-semibold text-gray-900 break-words">{row.description}</span>
                            <span className="text-sm font-black text-gray-900 tabular-nums shrink-0">R$ {fmt(row.amount)}</span>
                          </div>
                          <p className="text-xs text-gray-500">{displayDate(row.date)}</p>
                          <select
                            value={type ?? ''}
                            onChange={e => updateIncomeRow(row.pluggyId, e.target.value === '' ? null : e.target.value)}
                            className="w-full p-0.5 border rounded text-xs bg-transparent focus:bg-white"
                          >
                            <option value="">Selecione...</option>
                            {[...incomeTypes].sort().map(t => (<option key={t} value={t}>{t}</option>))}
                          </select>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            {unclassifiedIncomes > 0 && (
              <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2 mt-3">
                ⚠ {unclassifiedIncomes} {unclassifiedIncomes === 1 ? 'receita sem tipo válido' : 'receitas sem tipo válido'} — {unclassifiedIncomes === 1 ? 'não será importada' : 'não serão importadas'}.
              </p>
            )}

            {incomeRows.length > 0 && (
              <div className="mt-3">
                <button
                  onClick={handleConfirmIncomes}
                  disabled={importingIncomes || categoriesLoading || selectedIncomeIds.size === 0}
                  className="py-2 px-4 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {importingIncomes ? 'Importando...' : `Confirmar selecionadas (${selectedIncomeIds.size})`}
                </button>
              </div>
            )}
          </section>

          {/* Ignored — collapsible, one-click un-ignore */}
          <section>
            <button
              onClick={() => setIgnoredExpanded(v => !v)}
              className="text-base font-bold flex items-center gap-2"
            >
              {ignoredExpanded ? '▼' : '▶'} Ignoradas ({ignoredRows.length})
            </button>
            {ignoredExpanded && (
              ignoredRows.length === 0 ? (
                <p className="text-sm text-gray-400 mt-2">Nenhuma transação ignorada.</p>
              ) : (
                <ul className="mt-2 divide-y divide-gray-200 border rounded-lg overflow-hidden">
                  {ignoredRows.map(row => (
                    <li key={row.pluggyId} className="flex items-center justify-between gap-3 p-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{row.description}</p>
                        <p className="text-xs text-gray-500">{displayDate(row.date)} · R$ {fmt(row.amount)}</p>
                        {row.statusReason && <p className="text-[10px] text-gray-400 mt-0.5">{row.statusReason}</p>}
                      </div>
                      <button
                        onClick={() => handleUnignore(row.pluggyId)}
                        className="shrink-0 py-1.5 px-3 border border-gray-300 rounded text-xs font-bold hover:bg-gray-50"
                      >
                        Não ignorar
                      </button>
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>

          {/* Anomalies — informational only, a poller must never auto-correct these */}
          <section>
            <button
              onClick={() => setAnomaliesExpanded(v => !v)}
              className="text-base font-bold flex items-center gap-2"
            >
              {anomaliesExpanded ? '▼' : '▶'} Anomalias ({anomalyRows.length})
            </button>
            {anomaliesExpanded && (
              anomalyRows.length === 0 ? (
                <p className="text-sm text-gray-400 mt-2">Nenhuma anomalia.</p>
              ) : (
                <ul className="mt-2 divide-y divide-gray-200 border border-red-200 rounded-lg overflow-hidden">
                  {anomalyRows.map(row => (
                    <li key={row.pluggyId} className="p-3 bg-red-50">
                      <p className="text-sm font-semibold text-gray-800">{row.description}</p>
                      <p className="text-xs text-gray-500">{displayDate(row.date)} · R$ {fmt(row.amount)}</p>
                      {row.statusReason && <p className="text-xs text-red-700 mt-0.5">{row.statusReason}</p>}
                    </li>
                  ))}
                </ul>
              )
            )}
          </section>

          <div>
            <button
              onClick={onDone}
              className="py-2 px-4 border border-gray-300 rounded text-sm font-bold hover:bg-gray-50"
            >
              Voltar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
