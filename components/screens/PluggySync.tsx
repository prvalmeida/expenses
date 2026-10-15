'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Clock, Inbox, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react';
import { useCategories } from '@/hooks/useCategories';
import { ICON_STROKE } from '@/components/shell/nav';
import { Button, FOCUS_RING } from '@/components/ui/Button';
import { Card, Chip, EmptyState, Notice } from '@/components/ui/display';
import { formatBRL } from '@/lib/utils/money';
import { shortDate } from '@/lib/utils/monthUtils';

const PAYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'credit', label: 'Crédito' },
  { value: 'debit', label: 'Débito' },
  { value: 'pix', label: 'Pix' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'food-voucher', label: 'Vale-alimentação' },
  { value: 'meal-voucher', label: 'Vale-refeição' },
  { value: 'fuel-voucher', label: 'Vale-combustível' },
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
  suggestedBy?: 'history' | 'ai';
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
  suggestions?: {
    expensesSuggested: number;
    incomesSuggested: number;
    historyHits: number;
    aiCalls: number;
    aiAnswers: number;
    unclassified: number;
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

    // The suggestion pass runs after the auto-import, so its counts describe
    // the queue the user is about to review. Absent when the pass failed —
    // a failed GPT call is a degraded sync, not a failed one, and the fetch
    // and auto-import lines above already reported what did happen.
    // historyHits/aiAnswers count distinct merchant descriptions answered,
    // while `suggested` counts the staged rows that received one — several
    // rows of the same merchant share one answer.
    if (data.suggestions) {
      const { expensesSuggested, incomesSuggested, historyHits, aiAnswers, aiCalls, unclassified } = data.suggestions;
      const suggested = expensesSuggested + incomesSuggested;
      if (suggested > 0) {
        lines.push(
          `✓ ${suggested} ${suggested === 1 ? 'linha com categoria sugerida' : 'linhas com categoria sugerida'} ` +
            `(${historyHits + aiAnswers} ${historyHits + aiAnswers === 1 ? 'comerciante' : 'comerciantes'}: ` +
            `${historyHits} pelo histórico, ${aiAnswers} pela IA em ${aiCalls} ${aiCalls === 1 ? 'chamada' : 'chamadas'})` +
            (unclassified > 0 ? ` · ${unclassified} ${unclassified === 1 ? 'comerciante' : 'comerciantes'} sem classificação confiável` : '')
        );
      }
    }
  }

  for (const item of items) {
    if (!HEALTHY_ITEM_STATUSES.has(item.status)) lines.push(`⚠ Conexão ${item.itemId}: ${item.status}`);
  }

  return lines.join('\n');
}

export default function PluggySync() {
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
      const nextExpenseRows: ExpenseRowState[] = pending
        .filter(r => r.direction === 'outflow')
        .map(r => ({
          ...r,
          resolvedType: r.suggestedType ?? null,
          resolvedSubtype: r.suggestedSubtype ?? null,
          resolvedPaymentType: r.paymentType ?? 'debit',
          resolvedCardBrand: r.cardBrand ?? '',
        }));
      const nextIncomeRows: IncomeRowState[] = pending
        .filter(r => r.direction === 'inflow')
        .map(r => ({
          ...r,
          resolvedType: r.suggestedType ?? null,
        }));
      setExpenseRows(nextExpenseRows);
      setIncomeRows(nextIncomeRows);
      setIgnoredRows(ignored);
      setAnomalyRows(anomalies);
      // Selection is reset here and re-populated by the pre-check effect
      // below once categories resolve — the pre-check must use the effective
      // (validated) suggestion, which load() cannot know before useCategories
      // finishes.
      setSelectedExpenseIds(new Set());
      setSelectedIncomeIds(new Set());
    } catch {
      setError('Erro ao carregar transações Pluggy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Pre-check rows whose suggestion is still VALID, once categories resolve —
  // not inside load(), which runs before useCategories finishes. A category
  // renamed after the suggestion pass wrote the hint leaves an orphaned
  // suggestedType/suggestedSubtype on a row, and pre-checking on the raw value
  // would tick a box the confirm gate then silently drops. Reusing the same
  // effective* predicates the confirm gate applies means a checked box always
  // means "ready to import". An expense needs both category and subcategory
  // resolved; an income has no subcategory, so its type alone qualifies.
  useEffect(() => {
    if (categoriesLoading) return;
    setSelectedExpenseIds(
      new Set(
        expenseRows
          .filter(r => {
            const type = effectiveType(r.resolvedType);
            return type !== null && effectiveSubtype(type, r.resolvedSubtype) !== null;
          })
          .map(r => r.pluggyId)
      )
    );
    setSelectedIncomeIds(
      new Set(incomeRows.filter(r => effectiveIncomeType(r.resolvedType) !== null).map(r => r.pluggyId))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoriesLoading, expenseRows, incomeRows]);

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
    // A suggestion that came from the mapping itself (suggestedBy unset:
    // autoImportStaged's orphaned-pair hint) confirmed as-is leaves the
    // mapping alone; one that came from the history/AI pass does not —
    // confirming it as-is is exactly the moment the merchant's classification
    // becomes human-approved, and not saving it would leave every
    // first-occurrence merchant re-suggested forever (the flywheel the
    // receipt import has via ProductMapping).
    const items = ready.map(({ row, type, subtype }) => {
      const suggestedType = effectiveType(row.suggestedType ?? null);
      const suggestedSubtype = effectiveSubtype(suggestedType, row.suggestedSubtype ?? null);
      const newMapping =
        row.suggestedBy !== undefined || type !== suggestedType || subtype !== suggestedSubtype;
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

  const readyExpenses = expenseRows.filter(r => {
    const type = effectiveType(r.resolvedType);
    return type !== null && (r.resolvedPaymentType !== 'credit' || r.resolvedCardBrand !== '');
  }).length;
  const nothingPending = expenseRows.length === 0 && incomeRows.length === 0;

  return (
    <div className="mx-auto flex max-w-[960px] flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-semibold leading-7 tracking-[-0.01em]">Revisar</h1>
          <p className="text-[13px] text-ink-muted">Transações do banco que ainda precisam de categoria.</p>
        </div>
        <Button icon={RefreshCw} onClick={handleSync} disabled={syncing}>
          {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
        </Button>
      </div>

      {error && <Notice tone="error" title={error} />}
      {notice && (
        <Notice tone="info">
          <span className="whitespace-pre-line">{notice}</span>
        </Notice>
      )}

      {loading ? (
        <div className="flex flex-col gap-3" aria-busy="true" aria-label="Carregando">
          <div className="h-64 animate-pulse rounded-card bg-surface-2" />
          <div className="h-32 animate-pulse rounded-card bg-surface-2" />
        </div>
      ) : (
        <>
          {nothingPending && (
            <Card>
              <EmptyState icon={Inbox} title="Nada para revisar">
                As transações novas do banco aparecem aqui depois de cada sincronização.
              </EmptyState>
            </Card>
          )}

          {expenseRows.length > 0 && (
            <Card flush title={`Gastos · ${expenseRows.length}`}>
              <SelectAllBar
                checked={allExpensesSelected}
                inputRef={selectAllExpensesRef}
                onChange={selectAllExpenses}
                label={`${selectedExpenseIds.size} de ${expenseRows.length} selecionados · ${readyExpenses} prontos para importar`}
              />
              <ul>
                {expenseRows.map(row => (
                  <ExpenseReviewRow
                    key={row.pluggyId}
                    row={row}
                    type={effectiveType(row.resolvedType)}
                    subtype={effectiveSubtype(effectiveType(row.resolvedType), row.resolvedSubtype)}
                    expenseTypes={expenseTypes}
                    subtypesFor={subtypesFor}
                    checked={selectedExpenseIds.has(row.pluggyId)}
                    onCheck={on => toggleExpenseSelected(row.pluggyId, on)}
                    onChange={(field, value) => updateExpenseRow(row.pluggyId, field, value)}
                  />
                ))}
              </ul>
              <SectionFooter
                warnings={[
                  unclassifiedExpenses > 0 &&
                    `${unclassifiedExpenses} ${unclassifiedExpenses === 1 ? 'gasto sem categoria válida' : 'gastos sem categoria válida'} — ${unclassifiedExpenses === 1 ? 'não será importado' : 'não serão importados'}.`,
                  expensesMissingCardBrand > 0 &&
                    `${expensesMissingCardBrand} ${expensesMissingCardBrand === 1 ? 'gasto no crédito sem cartão' : 'gastos no crédito sem cartão'} — ${expensesMissingCardBrand === 1 ? 'não será importado' : 'não serão importados'} até você escolher o cartão.`,
                ]}
                action={
                  <Button
                    variant="primary"
                    onClick={handleConfirmExpenses}
                    disabled={importingExpenses || categoriesLoading || selectedExpenseIds.size === 0}
                  >
                    {importingExpenses ? 'Importando…' : `Importar ${selectedExpenseIds.size} ${selectedExpenseIds.size === 1 ? 'gasto' : 'gastos'}`}
                  </Button>
                }
              />
            </Card>
          )}

          {incomeRows.length > 0 && (
            <Card flush title={`Receitas · ${incomeRows.length}`}>
              <SelectAllBar
                checked={allIncomesSelected}
                inputRef={selectAllIncomesRef}
                onChange={selectAllIncomes}
                label={`${selectedIncomeIds.size} de ${incomeRows.length} selecionadas`}
              />
              <ul>
                {incomeRows.map(row => {
                  const type = effectiveIncomeType(row.resolvedType);
                  return (
                    <li key={row.pluggyId} className="flex gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
                      <RowCheckbox checked={selectedIncomeIds.has(row.pluggyId)} onChange={on => toggleIncomeSelected(row.pluggyId, on)} label={row.description} />
                      <div className="flex min-w-0 flex-1 flex-col gap-2">
                        <RowHeading row={row} sign />
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          <Field label="Tipo" warning={type === null && row.resolvedType !== null ? `“${row.resolvedType}” não existe mais` : null} hint={suggestionHint(row, type !== null && type === (row.suggestedType ?? null))}>
                            <CompactSelect
                              value={type ?? ''}
                              onChange={v => updateIncomeRow(row.pluggyId, v === '' ? null : v)}
                              placeholder="Selecione…"
                              options={[...incomeTypes].sort()}
                            />
                          </Field>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
              <SectionFooter
                warnings={[
                  unclassifiedIncomes > 0 &&
                    `${unclassifiedIncomes} ${unclassifiedIncomes === 1 ? 'receita sem tipo válido' : 'receitas sem tipo válido'} — ${unclassifiedIncomes === 1 ? 'não será importada' : 'não serão importadas'}.`,
                ]}
                action={
                  <Button
                    variant={expenseRows.length > 0 ? 'secondary' : 'primary'}
                    onClick={handleConfirmIncomes}
                    disabled={importingIncomes || categoriesLoading || selectedIncomeIds.size === 0}
                  >
                    {importingIncomes ? 'Importando…' : `Importar ${selectedIncomeIds.size} ${selectedIncomeIds.size === 1 ? 'receita' : 'receitas'}`}
                  </Button>
                }
              />
            </Card>
          )}

          {/* Ignored — collapsed by default, one-click un-ignore. */}
          <Collapsible title="Ignoradas" count={ignoredRows.length} open={ignoredExpanded} onToggle={() => setIgnoredExpanded(v => !v)}>
            {ignoredRows.length === 0 ? (
              <p className="px-4 pb-4 text-ink-muted sm:px-5">Nenhuma transação ignorada.</p>
            ) : (
              <ul>
                {ignoredRows.map(row => (
                  <li key={row.pluggyId} className="flex items-center gap-3 border-t border-border px-4 py-3 sm:px-5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{row.description}</p>
                      <p className="text-xs text-ink-muted">{shortDate(row.date)} · {formatBRL(Math.abs(row.amount))}{row.statusReason ? ` · ${row.statusReason}` : ''}</p>
                    </div>
                    <Button size="sm" onClick={() => handleUnignore(row.pluggyId)}>Não ignorar</Button>
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>

          {/* Anomalies — informational only; a poller must never auto-correct these. */}
          <Collapsible title="Anomalias" count={anomalyRows.length} open={anomaliesExpanded} onToggle={() => setAnomaliesExpanded(v => !v)} warn={anomalyRows.length > 0}>
            {anomalyRows.length === 0 ? (
              <p className="px-4 pb-4 text-ink-muted sm:px-5">Nenhuma anomalia.</p>
            ) : (
              <ul>
                {anomalyRows.map(row => (
                  <li key={row.pluggyId} className="flex gap-3 border-t border-border px-4 py-3 sm:px-5">
                    <CircleAlert size={20} strokeWidth={ICON_STROKE} aria-hidden="true" className="mt-px shrink-0 text-negative" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{row.description}</p>
                      <p className="text-xs text-ink-muted">{shortDate(row.date)} · {formatBRL(Math.abs(row.amount))}</p>
                      {row.statusReason && <p className="mt-0.5 text-[13px] text-negative">{row.statusReason}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Collapsible>
        </>
      )}
    </div>
  );
}

function suggestionHint(row: PluggyTransactionRow, matchesSuggestion: boolean): string | null {
  if (row.suggestedBy === undefined || !matchesSuggestion) return null;
  return row.suggestedBy === 'ai' ? 'Sugerido pela IA' : 'Sugerido pelo histórico';
}

function ExpenseReviewRow({ row, type, subtype, expenseTypes, subtypesFor, checked, onCheck, onChange }: {
  row: ExpenseRowState;
  type: string | null;
  subtype: string | null;
  expenseTypes: string[];
  subtypesFor: (type: string) => string[];
  checked: boolean;
  onCheck: (on: boolean) => void;
  onChange: <K extends keyof ExpenseRowState>(field: K, value: ExpenseRowState[K]) => void;
}) {
  const typeOrphaned = type === null && row.resolvedType !== null;
  const subtypeOrphaned = subtype === null && type !== null && row.resolvedSubtype !== null;
  const needsCardBrand = row.resolvedPaymentType === 'credit' && !row.resolvedCardBrand;
  const matchesSuggestion = type !== null && type === (row.suggestedType ?? null) && subtype === (row.suggestedSubtype ?? null);
  return (
    <li className="flex gap-3 border-t border-border px-4 py-3 first:border-t-0 sm:px-5">
      <RowCheckbox checked={checked} onChange={onCheck} label={row.description} />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <RowHeading row={row} />
        {/* Two per row even on a phone: four stacked full-width selects per transaction made
            a ten-row queue several screens long. */}
        <div className={`grid grid-cols-2 gap-2 ${row.resolvedPaymentType === 'credit' ? 'lg:grid-cols-4' : 'lg:grid-cols-3'}`}>
          <Field label="Categoria" warning={typeOrphaned ? `“${row.resolvedType}” não existe mais` : null} hint={suggestionHint(row, matchesSuggestion)}>
            <CompactSelect
              value={type ?? ''}
              onChange={v => onChange('resolvedType', v === '' ? null : v)}
              placeholder="Selecione…"
              options={[...expenseTypes].sort()}
            />
          </Field>
          <Field label="Subcategoria" warning={subtypeOrphaned ? `“${row.resolvedSubtype}” não existe mais` : null}>
            <CompactSelect
              value={subtype ?? ''}
              onChange={v => onChange('resolvedSubtype', v === '' ? null : v)}
              placeholder={type ? 'Selecione…' : 'Escolha a categoria'}
              options={type ? [...subtypesFor(type)].sort() : []}
              disabled={!type}
            />
          </Field>
          <Field label="Pagamento">
            <CompactSelect
              value={row.resolvedPaymentType}
              onChange={v => onChange('resolvedPaymentType', v)}
              options={PAYMENT_TYPE_OPTIONS}
            />
          </Field>
          {row.resolvedPaymentType === 'credit' && (
            <Field label="Cartão" warning={needsCardBrand ? 'Obrigatório no crédito' : null}>
              <CompactSelect
                value={row.resolvedCardBrand}
                onChange={v => onChange('resolvedCardBrand', v)}
                placeholder="Escolha o cartão"
                options={CARD_BRANDS}
              />
            </Field>
          )}
        </div>
      </div>
    </li>
  );
}

// A PENDING row is still mutable at the bank: its amount can change and it can vanish
// entirely, which is why autoImportStaged never touches one. It is importable by hand, so
// the flag has to be visible next to the description.
function RowHeading({ row, sign = false }: { row: PluggyTransactionRow; sign?: boolean }) {
  const installment = row.installmentCurrent !== undefined && row.installmentTotal !== undefined
    ? ` · parcela ${row.installmentCurrent}/${row.installmentTotal}`
    : '';
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="break-words font-medium">{row.description}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-muted">
          {row.pluggyStatus === 'PENDING' && (
            <span title="Lançamento ainda não consolidado pelo banco — valor e data podem mudar.">
              <Chip tone="warning" icon={Clock}>Pendente no banco</Chip>
            </span>
          )}
          <span>{shortDate(row.date)}{installment}</span>
        </p>
      </div>
      <span className={`shrink-0 font-medium tabular-nums ${sign ? 'text-positive' : ''}`}>
        {formatBRL(Math.abs(row.amount), { sign })}
      </span>
    </div>
  );
}

function RowCheckbox({ checked, onChange, label }: { checked: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <input
      type="checkbox"
      checked={checked}
      onChange={e => onChange(e.target.checked)}
      aria-label={`Selecionar ${label}`}
      className="mt-1 h-4 w-4 shrink-0 accent-[var(--accent)]"
    />
  );
}

function SelectAllBar({ checked, inputRef, onChange, label }: { checked: boolean; inputRef: (el: HTMLInputElement | null) => void; onChange: (on: boolean) => void; label: string }) {
  return (
    <div className="flex min-h-12 items-center gap-3 border-y border-border bg-surface-2 px-4 sm:px-5">
      <input
        type="checkbox"
        ref={inputRef}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        aria-label="Selecionar todos"
        className="h-4 w-4 accent-[var(--accent)]"
      />
      <span className="text-[13px] text-ink-muted">{label}</span>
    </div>
  );
}

function SectionFooter({ warnings, action }: { warnings: (string | false)[]; action: ReactNode }) {
  const shown = warnings.filter((w): w is string => !!w);
  return (
    <div className="flex flex-col gap-3 border-t border-border px-4 py-3 sm:px-5">
      {shown.map(w => <Notice key={w} tone="warning">{w}</Notice>)}
      <div className="flex justify-end">{action}</div>
    </div>
  );
}

function Field({ label, warning, hint, children }: { label: string; warning?: string | null; hint?: string | null; children: ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {warning && (
        <span className="flex items-center gap-1 text-xs text-warning">
          <TriangleAlert size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{warning}
        </span>
      )}
      {!warning && hint && (
        <span className="flex items-center gap-1 text-xs text-ink-muted">
          <Sparkles size={14} strokeWidth={ICON_STROKE} aria-hidden="true" />{hint}
        </span>
      )}
    </label>
  );
}

// Denser than the form Select (10 rows × 4 selects on one screen) but still 40px tall
// for touch, with the field text at 16px so iOS does not zoom on focus.
function CompactSelect({ value, onChange, options, placeholder, disabled }: {
  value: string;
  onChange: (value: string) => void;
  options: (string | { value: string; label: string })[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <span className="relative flex min-h-10 items-center rounded-control border border-border-strong bg-surface-1 focus-within:outline-2 focus-within:outline-offset-1 focus-within:outline-focus has-[:disabled]:border-border has-[:disabled]:bg-surface-2">
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        disabled={disabled}
        className="h-full min-h-[38px] w-full min-w-0 cursor-pointer appearance-none bg-transparent pl-3 pr-9 text-base text-ink outline-none disabled:cursor-not-allowed disabled:text-ink-disabled sm:text-sm"
      >
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map(o => (typeof o === 'string'
          ? <option key={o} value={o}>{o}</option>
          : <option key={o.value} value={o.value}>{o.label}</option>))}
      </select>
      <ChevronDown size={16} strokeWidth={ICON_STROKE} aria-hidden="true" className="pointer-events-none absolute right-3 text-ink-muted" />
    </span>
  );
}

function Collapsible({ title, count, open, onToggle, warn = false, children }: { title: string; count: number; open: boolean; onToggle: () => void; warn?: boolean; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-card border border-border bg-surface-1">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={`flex min-h-12 w-full items-center gap-2 px-4 text-left hover:bg-surface-2 sm:px-5 ${FOCUS_RING} focus-visible:-outline-offset-2`}
      >
        <ChevronRight size={18} strokeWidth={ICON_STROKE} aria-hidden="true" className={`shrink-0 text-ink-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="flex-1 font-semibold">{title}</span>
        <Chip tone={warn ? 'warning' : 'neutral'}>{count}</Chip>
      </button>
      {open && <div className="pt-1">{children}</div>}
    </section>
  );
}
