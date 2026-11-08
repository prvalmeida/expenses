// Renders the daily Telegram message. Pure and dependency-free on purpose: the
// daily job runs with no agent, so this string IS the deliverable — and it is
// the one place the "R$ 42,90" house format must not drift.

import { formatBRL } from '../../lib/utils/money';

export interface DigestExpenseLike {
  name: string;
  value: number;
  date: string;
  type: string;
  subtype?: string | null;
}

export interface DigestIncomeLike {
  name: string;
  value: number;
  date: string;
}

export interface DigestLike {
  /** Full counts; the lists may be capped for display. */
  counts?: { expenses: number; incomes: number };
  expenses: DigestExpenseLike[];
  incomes: DigestIncomeLike[];
  totals: { expenses: number; incomes: number };
  pending: { count: number; total: number };
  anomalies: number;
}

export interface SyncAccountLike {
  accountId?: string;
  name?: string;
  error?: string;
}

export interface SyncItemLike {
  itemId?: string;
  label?: string;
  status?: string;
}

export interface SyncLike {
  accounts?: SyncAccountLike[];
  items?: SyncItemLike[];
}

export interface DigestMessageInput {
  /** `YYYY-MM-DD` — the day the message reports on. */
  today: string;
  digest: DigestLike;
  /** The POST /pluggy/sync body, when the job ran the sync itself. */
  sync?: SyncLike | null;
  /** The sync answered `{ locked: true }`: another run holds the lock. */
  locked?: boolean;
  /** False when the job ran with --no-sync: the header must not claim a sync. */
  synced?: boolean;
  /** Month total by fluxo de caixa, for the "where the month stands" line. */
  monthToDate?: number | null;
  maxExpenses?: number;
  maxIncomes?: number;
}

const DEFAULT_MAX_EXPENSES = 15;
const DEFAULT_MAX_INCOMES = 5;

// Pluggy item statuses that mean "a human has to reconnect/login". OUTDATED and
// WAITING_USER_INPUT are as actionable as LOGIN_ERROR; UPDATED/UPDATING are the
// healthy ones and stay silent.
const BROKEN_ITEM_STATUSES = new Set(['LOGIN_ERROR', 'OUTDATED', 'WAITING_USER_INPUT']);
const BROKEN_STATUS_PREFIX = 'REFRESH_FAILED';

const shortDate = (isoDate: string): string => {
  const [, month, day] = isoDate.split('-');
  return `${day}/${month}`;
};

const place = (expense: DigestExpenseLike): string =>
  expense.subtype ? `${expense.type} › ${expense.subtype}` : expense.type;

function syncWarnings(sync: SyncLike | null | undefined): string[] {
  if (!sync) return [];

  const warnings: string[] = [];
  for (const account of sync.accounts ?? []) {
    if (!account.error) continue;
    const who = account.name ?? account.accountId ?? 'conta';
    warnings.push(`⚠️ ${who}: falhou ao sincronizar (${account.error})`);
  }
  for (const item of sync.items ?? []) {
    const status = item.status ?? '';
    if (!BROKEN_ITEM_STATUSES.has(status) && !status.startsWith(BROKEN_STATUS_PREFIX)) continue;
    const who = item.label ?? item.itemId ?? 'conexão';
    warnings.push(`⚠️ ${who}: ${status}`);
  }
  return warnings;
}

export function formatDigest(input: DigestMessageInput): string {
  const { digest, sync, locked } = input;
  const maxExpenses = input.maxExpenses ?? DEFAULT_MAX_EXPENSES;
  const maxIncomes = input.maxIncomes ?? DEFAULT_MAX_INCOMES;

  const lines: string[] = [];
  if (locked) {
    lines.push(`⏳ Sync de ${shortDate(input.today)} — outra execução ainda está rodando`);
  } else if (input.synced === false) {
    lines.push(`📊 Resumo de ${shortDate(input.today)}`);
  } else {
    lines.push(`🔄 Sync de ${shortDate(input.today)} concluída`);
  }
  lines.push('');

  const expenseCount = digest.counts?.expenses ?? digest.expenses.length;
  const incomeCount = digest.counts?.incomes ?? digest.incomes.length;

  if (digest.expenses.length === 0 && digest.incomes.length === 0) {
    lines.push('Nenhum gasto nem receita nova.');
  } else {
    if (expenseCount > 0) {
      lines.push(`Novos gastos (${expenseCount}) — ${formatBRL(digest.totals.expenses)}`);
      for (const expense of digest.expenses.slice(0, maxExpenses)) {
        lines.push(
          `• ${shortDate(expense.date)} ${expense.name} — ${formatBRL(expense.value)} · ${place(expense)}`
        );
      }
      const hidden = expenseCount - Math.min(digest.expenses.length, maxExpenses);
      if (hidden > 0) lines.push(`…e mais ${hidden} gasto${hidden > 1 ? 's' : ''}`);
    }

    if (incomeCount > 0) {
      if (expenseCount > 0) lines.push('');
      lines.push(`Novas receitas (${incomeCount}) — ${formatBRL(digest.totals.incomes)}`);
      for (const income of digest.incomes.slice(0, maxIncomes)) {
        lines.push(`• ${shortDate(income.date)} ${income.name} — ${formatBRL(income.value)}`);
      }
      const hidden = incomeCount - Math.min(digest.incomes.length, maxIncomes);
      if (hidden > 0) lines.push(`…e mais ${hidden} receita${hidden > 1 ? 's' : ''}`);
    }
  }

  const warnings = syncWarnings(sync);
  if (warnings.length > 0) {
    lines.push('');
    lines.push(...warnings);
  }

  if (digest.pending.count > 0) {
    lines.push('');
    lines.push(
      `⏳ ${digest.pending.count} aguardando revisão — ${formatBRL(digest.pending.total)}`
    );
  }

  if (digest.anomalies > 0) {
    lines.push(`🚨 ${digest.anomalies} transaç${digest.anomalies > 1 ? 'ões' : 'ão'} em anomalia`);
  }

  if (typeof input.monthToDate === 'number') {
    lines.push('');
    lines.push(`Mês até agora (fluxo de caixa): ${formatBRL(input.monthToDate)}`);
  }

  return lines.join('\n');
}
