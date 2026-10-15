'use client';

import { useCallback, useEffect, useState } from 'react';
import { CardBrand } from '@/types';
import { useCategories } from '@/hooks/useCategories';

const PLUGGY_CONNECT_SCRIPT_SRC = 'https://cdn.pluggy.ai/pluggy-connect/latest/pluggy-connect.js';

const BANK_PAYMENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'debit', label: 'Débito' },
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'food-voucher', label: 'Vale Alimentação' },
  { value: 'meal-voucher', label: 'Vale Refeição' },
  { value: 'fuel-voucher', label: 'Vale Combustível' },
];

const STATUS_LABELS: Record<string, string> = {
  UPDATED: 'Atualizado',
  UPDATING: 'Atualizando...',
  LOGIN_ERROR: 'Reconecte no Meu Pluggy',
  WAITING_USER_ACTION: 'Ação necessária no Meu Pluggy',
  OUTDATED: 'Desatualizado',
};

const STATUS_COLORS: Record<string, string> = {
  UPDATED: 'text-green-700 bg-green-50',
  UPDATING: 'text-blue-700 bg-blue-50',
  LOGIN_ERROR: 'text-red-700 bg-red-50',
  WAITING_USER_ACTION: 'text-amber-700 bg-amber-50',
  OUTDATED: 'text-amber-700 bg-amber-50',
};

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function statusColor(status: string) {
  return STATUS_COLORS[status] ?? 'text-gray-700 bg-gray-50';
}

interface PluggyItemRow {
  itemId: string;
  connectorId: number;
  label: string;
  status: string;
}

interface PluggyAccountRow {
  accountId: string;
  itemId: string;
  kind: 'BANK' | 'CREDIT';
  name: string;
  number?: string;
  enabled: boolean;
  cardBrand?: string;
  defaultPaymentType?: string;
  defaultIncomeType?: string;
  connectedAt: string;
  lastSyncedAt?: string;
}

interface AccountFormState {
  enabled: boolean;
  cardBrand: string;
  defaultPaymentType: string;
  defaultIncomeType: string;
  // Draft of the date input — saved on blur, not on every keystroke, since
  // typing a year fires intermediate values (0002, 0020, 2026).
  connectedAt: string;
}

// Mirrors MAX_SYNC_LOOKBACK_DAYS (lib/api/schemas/pluggy.ts) minus a day: the
// server bounds on the UTC date and this input on the local one, so near
// midnight the two can disagree by a day.
const SYNC_START_LOOKBACK_DAYS = 364;

function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatIsoDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

function formFromAccount(account: PluggyAccountRow): AccountFormState {
  return {
    enabled: account.enabled,
    cardBrand: account.cardBrand ?? '',
    defaultPaymentType: account.defaultPaymentType ?? '',
    defaultIncomeType: account.defaultIncomeType ?? '',
    connectedAt: account.connectedAt,
  };
}

// A CREDIT account cannot be enabled (or saved at all — the PUT's refine
// requires it) until its card is chosen.
function canEnable(account: PluggyAccountRow, form: AccountFormState): boolean {
  return account.kind === 'BANK' || Boolean(form.cardBrand);
}

// The widget is loaded from a <script> tag rather than an npm dependency —
// it is a browser-only third-party bundle with no server-side use, so it has
// none of the standalone-output tracing concerns CLAUDE.md documents for
// pdfjs-dist. Cached on window so a re-render never injects it twice.
declare global {
  interface Window {
    PluggyConnect?: new (options: {
      connectToken: string;
      includeSandbox?: boolean;
      onSuccess: (itemData: { item?: { id?: string }; id?: string }) => void;
      onError?: (error: unknown) => void;
    }) => { init: () => void };
  }
}

function loadPluggyConnectScript(): Promise<void> {
  if (window.PluggyConnect) return Promise.resolve();
  const existing = document.querySelector<HTMLScriptElement>(`script[src="${PLUGGY_CONNECT_SCRIPT_SRC}"]`);
  if (existing) {
    return new Promise((resolve, reject) => {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('Falha ao carregar o widget Pluggy Connect')));
    });
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = PLUGGY_CONNECT_SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Falha ao carregar o widget Pluggy Connect'));
    document.body.appendChild(script);
  });
}

export default function PluggyConfig() {
  const { incomeTypes } = useCategories();

  const [items, setItems] = useState<PluggyItemRow[]>([]);
  const [accounts, setAccounts] = useState<PluggyAccountRow[]>([]);
  const [forms, setForms] = useState<Record<string, AccountFormState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingIds, setSavingIds] = useState<ReadonlySet<string>>(new Set());
  const [savedIds, setSavedIds] = useState<ReadonlySet<string>>(new Set());
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [bulkNotices, setBulkNotices] = useState<Record<string, string>>({});

  const [connectLabel, setConnectLabel] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [itemsRes, accountsRes] = await Promise.all([
        fetch('/api/pluggy/items'),
        fetch('/api/pluggy/accounts'),
      ]);
      if (!itemsRes.ok || !accountsRes.ok) {
        setError('Erro ao carregar dados da Pluggy');
        return;
      }
      const itemsData: PluggyItemRow[] = await itemsRes.json();
      const accountsData: PluggyAccountRow[] = await accountsRes.json();
      setItems(itemsData);
      setAccounts(accountsData);
      setForms(Object.fromEntries(accountsData.map(a => [a.accountId, formFromAccount(a)])));
    } catch {
      setError('Erro de rede ao carregar dados da Pluggy');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const setAccountForm = (accountId: string, patch: Partial<AccountFormState>) => {
    setForms(prev => ({ ...prev, [accountId]: { ...prev[accountId], ...patch } }));
  };

  const markSaving = (accountId: string, saving: boolean) => {
    setSavingIds(prev => {
      const next = new Set(prev);
      if (saving) next.add(accountId);
      else next.delete(accountId);
      return next;
    });
  };

  const flashSaved = (accountId: string) => {
    setSavedIds(prev => new Set(prev).add(accountId));
    setTimeout(() => {
      setSavedIds(prev => {
        const next = new Set(prev);
        next.delete(accountId);
        return next;
      });
    }, 2000);
  };

  // Every control saves on change — there is no "Salvar" button. The PUT is a
  // full replace (an omitted optional field is cleared), so the body is always
  // built from the row's complete merged state, never from the patch alone.
  // `connectedAt` is the one exception: it is sent only when the date itself
  // is being saved, so toggling an account whose stored start date has aged
  // past the lookback bound is not rejected for a field nobody touched.
  // On success only this row is replaced — a full load() would clobber the
  // in-flight state of any other row being saved at the same time.
  const saveAccount = async (account: PluggyAccountRow, patch: Partial<AccountFormState>) => {
    const previous = forms[account.accountId] ?? formFromAccount(account);
    const form = { ...previous, ...patch };
    if (!canEnable(account, form)) return;

    setAccountForm(account.accountId, patch);
    markSaving(account.accountId, true);
    setRowErrors(prev => {
      const next = { ...prev };
      delete next[account.accountId];
      return next;
    });

    // Roll the patched fields back to the STORED values, not `previous`: the
    // start date's onChange has already written the draft into `forms`, so
    // `previous` would restore the rejected date and it would read as saved.
    const fail = (message: string) => {
      const stored = formFromAccount(account);
      setAccountForm(account.accountId, Object.fromEntries(
        Object.keys(patch).map(key => [key, stored[key as keyof AccountFormState]])
      ) as Partial<AccountFormState>);
      setRowErrors(prev => ({ ...prev, [account.accountId]: message }));
    };

    try {
      const res = await fetch('/api/pluggy/accounts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.accountId,
          kind: account.kind,
          enabled: form.enabled,
          ...(account.kind === 'CREDIT' && { cardBrand: form.cardBrand }),
          ...(account.kind === 'BANK' && form.defaultPaymentType && { defaultPaymentType: form.defaultPaymentType }),
          ...(account.kind === 'BANK' && form.defaultIncomeType && { defaultIncomeType: form.defaultIncomeType }),
          ...(patch.connectedAt !== undefined && { connectedAt: form.connectedAt }),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        fail(data.error ?? 'Erro ao salvar conta');
        return;
      }
      const updated = data as PluggyAccountRow;
      setAccounts(prev => prev.map(a => (a.accountId === updated.accountId ? updated : a)));
      // Only the saved fields are reset from the server — a draft the user is
      // still typing in another control of this row must survive.
      setAccountForm(account.accountId, Object.fromEntries(
        Object.keys(patch).map(key => [key, formFromAccount(updated)[key as keyof AccountFormState]])
      ) as Partial<AccountFormState>);
      flashSaved(account.accountId);
    } catch {
      fail('Erro de rede ao salvar conta');
    } finally {
      markSaving(account.accountId, false);
    }
  };

  const handleStartDateBlur = (account: PluggyAccountRow) => {
    const draft = forms[account.accountId]?.connectedAt ?? account.connectedAt;
    if (draft === account.connectedAt) return;

    const max = localIsoDate(new Date());
    const min = localIsoDate(new Date(Date.now() - SYNC_START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft) || draft < min || draft > max) {
      setAccountForm(account.accountId, { connectedAt: account.connectedAt });
      setRowErrors(prev => ({
        ...prev,
        [account.accountId]: `Escolha uma data entre ${formatIsoDate(min)} e ${formatIsoDate(max)}.`,
      }));
      return;
    }
    saveAccount(account, { connectedAt: draft });
  };

  const handleToggleAll = async (itemId: string, itemAccounts: PluggyAccountRow[]) => {
    const formOf = (a: PluggyAccountRow) => forms[a.accountId] ?? formFromAccount(a);
    const eligible = itemAccounts.filter(a => canEnable(a, formOf(a)));
    // Same predicate as the button's `allEnabled` label: with no eligible
    // account, `[].every` is true and would turn a "Habilitar todas" click
    // into a silent disable that also clears the blocked-cards notice.
    const target = !(eligible.length > 0 && eligible.every(a => formOf(a).enabled));

    const blocked = target ? itemAccounts.filter(a => !canEnable(a, formOf(a))) : [];
    setBulkNotices(prev => {
      const next = { ...prev };
      if (blocked.length > 0) {
        next[itemId] =
          `${blocked.length === 1 ? '1 cartão precisa' : `${blocked.length} cartões precisam`} ` +
          'do cartão selecionado antes de ser habilitado.';
      } else {
        delete next[itemId];
      }
      return next;
    });

    await Promise.all(
      eligible.filter(a => formOf(a).enabled !== target).map(a => saveAccount(a, { enabled: target }))
    );
  };

  const handleConnect = async () => {
    const label = connectLabel.trim();
    if (!label) return;

    setConnecting(true);
    setConnectError(null);
    try {
      const tokenRes = await fetch('/api/pluggy/connect-token', { method: 'POST' });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok) {
        setConnectError(tokenData.error ?? 'Erro ao gerar token de conexão');
        return;
      }

      await loadPluggyConnectScript();
      if (!window.PluggyConnect) {
        setConnectError('Não foi possível carregar o widget da Pluggy.');
        return;
      }

      const widget = new window.PluggyConnect({
        connectToken: tokenData.accessToken,
        includeSandbox: false,
        onSuccess: async itemData => {
          const itemId = itemData?.item?.id ?? itemData?.id;
          if (!itemId) {
            setConnectError('A Pluggy não retornou o identificador da conexão.');
            return;
          }
          const res = await fetch('/api/pluggy/items', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ itemId, label }),
          });
          const data = await res.json();
          if (!res.ok) {
            setConnectError(data.error ?? 'Erro ao registrar conexão');
            return;
          }
          setConnectLabel('');
          await load();
        },
        onError: () => setConnectError('Erro ao conectar com a Pluggy.'),
      });
      widget.init();
    } catch {
      setConnectError('Erro de rede ao iniciar conexão com a Pluggy');
    } finally {
      setConnecting(false);
    }
  };

  const renderAccountRow = (account: PluggyAccountRow) => {
    const form = forms[account.accountId] ?? formFromAccount(account);
    const saving = savingIds.has(account.accountId);
    const saved = savedIds.has(account.accountId);
    const rowError = rowErrors[account.accountId];
    const enableable = canEnable(account, form);
    const maxStart = localIsoDate(new Date());
    const minStart = localIsoDate(new Date(Date.now() - SYNC_START_LOOKBACK_DAYS * 24 * 60 * 60 * 1000));

    return (
      <li key={account.accountId} className="px-4 py-3 space-y-2">
        <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={form.enabled}
            aria-label={`${form.enabled ? 'Desabilitar' : 'Habilitar'} ${account.name}`}
            onClick={() => saveAccount(account, { enabled: !form.enabled })}
            disabled={saving || !enableable}
            title={enableable ? undefined : 'Selecione o cartão para habilitar'}
            className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-40 ${
              form.enabled ? 'bg-blue-500' : 'bg-gray-300'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                form.enabled ? 'translate-x-4' : 'translate-x-0.5'
              }`}
            />
          </button>

          <div className="flex-1 min-w-0">
            <span className="text-sm font-semibold text-gray-800">{account.name}</span>
            {account.number && <span className="text-xs text-gray-400 ml-1">···{account.number}</span>}
            <span className="ml-2 text-[10px] font-black uppercase text-gray-400">
              {account.kind === 'CREDIT' ? 'Cartão' : 'Conta'}
            </span>
          </div>

          {account.kind === 'CREDIT' && (
            <select
              value={form.cardBrand}
              // Picking the card is the act of linking it, so a card chosen
              // for the first time is enabled in the same save.
              onChange={e =>
                saveAccount(account, { cardBrand: e.target.value, ...(!form.cardBrand && { enabled: true }) })
              }
              disabled={saving}
              className="p-1.5 border rounded text-xs"
            >
              {!form.cardBrand && <option value="">Selecione o cartão...</option>}
              {Object.entries(CardBrand).map(([key, value]) => (
                <option key={key} value={value}>{value}</option>
              ))}
            </select>
          )}

          {account.kind === 'BANK' && (
            <>
              <select
                value={form.defaultPaymentType}
                onChange={e => saveAccount(account, { defaultPaymentType: e.target.value })}
                disabled={saving}
                className="p-1.5 border rounded text-xs"
              >
                <option value="">Pagamento padrão...</option>
                {BANK_PAYMENT_TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
              </select>
              <select
                value={form.defaultIncomeType}
                onChange={e => saveAccount(account, { defaultIncomeType: e.target.value })}
                disabled={saving}
                className="p-1.5 border rounded text-xs"
              >
                <option value="">Sem receita automática</option>
                {[...incomeTypes].sort().map(t => (<option key={t} value={t}>{t}</option>))}
              </select>
            </>
          )}

          <span className="text-[10px] font-bold uppercase sm:w-16 shrink-0 sm:text-right" aria-live="polite">
            {saving ? (
              <span className="text-gray-400">Salvando...</span>
            ) : saved ? (
              <span className="text-green-600">Salvo</span>
            ) : null}
          </span>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 text-xs text-gray-500 sm:pl-12">
          <label className="flex items-center gap-2">
            <span>Sincronizar a partir de</span>
            <input
              type="date"
              value={form.connectedAt}
              min={minStart}
              max={maxStart}
              onChange={e => setAccountForm(account.accountId, { connectedAt: e.target.value })}
              onBlur={() => handleStartDateBlur(account)}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              disabled={saving}
              className="p-1 border rounded text-xs"
            />
          </label>
          <span className="text-gray-400">
            {account.lastSyncedAt
              ? `Última sincronização: ${new Date(account.lastSyncedAt).toLocaleString('pt-BR')}`
              : `Próxima sincronização buscará desde ${formatIsoDate(account.connectedAt)}`}
          </span>
        </div>

        {!enableable && (
          <p className="text-xs text-amber-700 sm:pl-12">Selecione o cartão para habilitar.</p>
        )}
        {rowError && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{rowError}</p>
        )}
      </li>
    );
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <h1 className="text-2xl font-bold">Conexões Pluggy</h1>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</p>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <h2 className="text-sm font-bold text-gray-800 uppercase tracking-wide mb-3">Conectar nova conta</h2>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="text"
            value={connectLabel}
            onChange={e => setConnectLabel(e.target.value)}
            placeholder="Nome do responsável (ex: Pedro)"
            className="flex-1 p-2 border rounded text-sm"
          />
          <button
            onClick={handleConnect}
            disabled={connecting || !connectLabel.trim()}
            className="py-2 px-4 bg-blue-500 text-white rounded text-sm font-bold hover:bg-blue-600 disabled:opacity-50"
          >
            {connecting ? 'Abrindo...' : 'Conectar via Pluggy Connect'}
          </button>
        </div>
        {connectError && (
          <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2 mt-3">{connectError}</p>
        )}
        <p className="text-xs text-gray-400 mt-2">
          Suas credenciais do banco vão direto para a Pluggy pelo widget — nunca passam por este servidor.
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-gray-400">Carregando...</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400">Nenhuma conexão Pluggy ainda.</p>
      ) : (
        <div className="space-y-4">
          {items.map(item => {
            const itemAccounts = accounts.filter(a => a.itemId === item.itemId);
            const enableableAccounts = itemAccounts.filter(a => canEnable(a, forms[a.accountId] ?? formFromAccount(a)));
            const allEnabled =
              enableableAccounts.length > 0 &&
              enableableAccounts.every(a => (forms[a.accountId] ?? formFromAccount(a)).enabled);
            return (
              <div key={item.itemId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-sm font-bold text-gray-800">{item.label}</span>
                    <span className="ml-2 text-xs text-gray-400">conector {item.connectorId}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {itemAccounts.length > 0 && (
                      <button
                        type="button"
                        onClick={() => handleToggleAll(item.itemId, itemAccounts)}
                        disabled={itemAccounts.some(a => savingIds.has(a.accountId))}
                        className="py-1 px-2 border border-blue-500 text-blue-600 rounded text-[11px] font-bold hover:bg-blue-50 disabled:opacity-50"
                      >
                        {allEnabled ? 'Desabilitar todas' : 'Habilitar todas'}
                      </button>
                    )}
                    <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${statusColor(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                </div>
                {bulkNotices[item.itemId] && (
                  <p className="px-4 py-2 text-xs text-amber-700 bg-amber-50 border-b border-amber-100">
                    {bulkNotices[item.itemId]}
                  </p>
                )}
                <ul className="divide-y divide-gray-100">
                  {itemAccounts.length === 0 ? (
                    <li className="px-4 py-3 text-xs text-gray-400">Nenhuma conta encontrada para este item.</li>
                  ) : (
                    itemAccounts.map(renderAccountRow)
                  )}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-xs text-gray-400">
        Desabilitar uma conta interrompe a busca e a importação, mas mantém o item, o vínculo e as transações
        já sincronizadas — não há exclusão por aqui.
      </p>
      <p className="text-xs text-gray-400">
        Em &quot;Sincronizar a partir de&quot;, use o dia seguinte ao fechamento da última fatura importada em PDF — o
        período anterior já está lançado e seria duplicado. Antecipar a data faz a próxima sincronização buscar
        desde a nova data; adiá-la move as transações pendentes anteriores a ela para &quot;Ignoradas&quot; (nada é
        apagado).
      </p>
    </div>
  );
}
