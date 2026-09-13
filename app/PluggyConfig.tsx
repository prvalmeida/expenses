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
}

interface AccountFormState {
  enabled: boolean;
  cardBrand: string;
  defaultPaymentType: string;
  defaultIncomeType: string;
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
  const [savingAccountId, setSavingAccountId] = useState<string | null>(null);

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
      setForms(
        Object.fromEntries(
          accountsData.map(a => [
            a.accountId,
            {
              enabled: a.enabled,
              cardBrand: a.cardBrand ?? '',
              defaultPaymentType: a.defaultPaymentType ?? '',
              defaultIncomeType: a.defaultIncomeType ?? '',
            },
          ])
        )
      );
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

  const handleSaveAccount = async (account: PluggyAccountRow) => {
    const form = forms[account.accountId];
    if (!form) return;
    if (account.kind === 'CREDIT' && !form.cardBrand) {
      setError('Selecione o cartão da conta antes de salvar.');
      return;
    }

    setSavingAccountId(account.accountId);
    setError(null);
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Erro ao salvar conta');
        return;
      }
      await load();
    } catch {
      setError('Erro de rede ao salvar conta');
    } finally {
      setSavingAccountId(null);
    }
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
    const form = forms[account.accountId] ?? {
      enabled: account.enabled,
      cardBrand: account.cardBrand ?? '',
      defaultPaymentType: '',
      defaultIncomeType: '',
    };
    const saving = savingAccountId === account.accountId;

    return (
      <li key={account.accountId} className="px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
        <label className="flex items-center gap-2 shrink-0">
          <input
            type="checkbox"
            checked={form.enabled}
            onChange={e => setAccountForm(account.accountId, { enabled: e.target.checked })}
          />
          <span className="text-xs font-bold text-gray-500 uppercase">Habilitada</span>
        </label>

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
            onChange={e => setAccountForm(account.accountId, { cardBrand: e.target.value })}
            className="p-1.5 border rounded text-xs"
          >
            <option value="">Selecione o cartão...</option>
            {Object.entries(CardBrand).map(([key, value]) => (
              <option key={key} value={value}>{value}</option>
            ))}
          </select>
        )}

        {account.kind === 'BANK' && (
          <>
            <select
              value={form.defaultPaymentType}
              onChange={e => setAccountForm(account.accountId, { defaultPaymentType: e.target.value })}
              className="p-1.5 border rounded text-xs"
            >
              <option value="">Pagamento padrão...</option>
              {BANK_PAYMENT_TYPE_OPTIONS.map(o => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
            <select
              value={form.defaultIncomeType}
              onChange={e => setAccountForm(account.accountId, { defaultIncomeType: e.target.value })}
              className="p-1.5 border rounded text-xs"
            >
              <option value="">Sem receita automática</option>
              {[...incomeTypes].sort().map(t => (<option key={t} value={t}>{t}</option>))}
            </select>
          </>
        )}

        <button
          onClick={() => handleSaveAccount(account)}
          disabled={saving || (account.kind === 'CREDIT' && !form.cardBrand)}
          className="py-1.5 px-3 bg-blue-500 text-white rounded text-xs font-bold hover:bg-blue-600 disabled:opacity-50 shrink-0"
        >
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
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
            return (
              <div key={item.itemId} className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between flex-wrap gap-2">
                  <div>
                    <span className="text-sm font-bold text-gray-800">{item.label}</span>
                    <span className="ml-2 text-xs text-gray-400">conector {item.connectorId}</span>
                  </div>
                  <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${statusColor(item.status)}`}>
                    {statusLabel(item.status)}
                  </span>
                </div>
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
    </div>
  );
}
