import { PluggyTransactionApi } from '../pluggy/client';
import { isPlausibleInstallment } from './billUtils';
import { MAX_INSTALLMENTS } from '../api/schemas/common';
import { addMonthsClamped } from './dateUtils';

// Collapses interior whitespace the way billMappingKey's normalizeDescription
// does (billUtils.ts), so a merchant description stays stable across syncs
// regardless of how Pluggy renders spacing.
function normalizeDescription(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

export interface PluggyRawFields {
  date: string;
  amount: number;
  currencyCode: string;
  descriptionRaw: string;
  description: string;
  merchantName?: string;
  pluggyCategory?: string;
  pluggyStatus: string;
  installmentCurrent?: number;
  installmentTotal?: number;
  paymentMethod?: string;
  raw: unknown;
}

// The functions in this file are the only place in the app that reads a raw
// Pluggy transaction field. Every field name is a hypothesis from the plan's
// §0 research table, unverified against a live account — centralizing the
// reads means a correction from a future spike touches this file and nothing
// that consumes its output.
export function mapPluggyTransaction(tx: PluggyTransactionApi): PluggyRawFields {
  const descriptionRaw = tx.description ?? '';
  return {
    date: tx.date,
    amount: tx.amount,
    currencyCode: tx.currencyCode ?? 'BRL',
    descriptionRaw,
    description: normalizeDescription(descriptionRaw),
    merchantName: tx.merchant?.name ?? undefined,
    pluggyCategory: tx.category ?? undefined,
    pluggyStatus: tx.status ?? 'POSTED',
    installmentCurrent: tx.creditCardMetadata?.installmentNumber ?? undefined,
    installmentTotal: tx.creditCardMetadata?.totalInstallments ?? undefined,
    paymentMethod: tx.paymentData?.paymentMethod ?? undefined,
    raw: tx,
  };
}

export type PluggyDirection = 'outflow' | 'inflow';

export interface DirectionResult {
  direction?: PluggyDirection;
  anomalyReason?: string;
}

// tx.type is the primary signal; the sign of `amount` is a cross-check, not a
// fallback. When the two disagree the row is written status: 'anomaly' rather
// than guessed — a sign error would turn an income into an expense, and there
// is no cheap way to notice that later.
//
// The cross-check is account-kind aware because Pluggy's sign convention is
// NOT uniform, as observed on live Caixa accounts:
//
//   CREDIT (card):  a purchase is  type=DEBIT,  amount POSITIVE  (NETFLIX 44.9)
//                   a refund is    type=CREDIT, amount NEGATIVE  (AJUSTE CRED -0.05)
//   BANK (account): a payment is   type=DEBIT,  amount NEGATIVE  (BOLETO -516.91)
//                   a deposit is   type=CREDIT, amount POSITIVE  (CRED PIX 6400)
//
// On a card statement the amount is the size of the charge against the bill,
// so an outflow reads positive; on an account it is the effect on the balance.
// Treating BANK's convention as universal made every single card purchase an
// anomaly — 71 of 86 rows in production — so no card expense could ever be
// imported.
//
// The account is REQUIRED: without it the sign carries no meaning, and an
// optional parameter would let a future caller silently apply the BANK
// convention to a card — re-arming the exact bug this fixes.
export function deriveDirection(
  tx: Pick<PluggyTransactionApi, 'type' | 'amount'>,
  account: Pick<PluggyAccountLike, 'kind'>
): DirectionResult {
  const byType: PluggyDirection | undefined =
    tx.type === 'DEBIT' ? 'outflow' : tx.type === 'CREDIT' ? 'inflow' : undefined;

  // A card outflow is positive; an account outflow is negative.
  const outflowIsPositive = account.kind === 'CREDIT';
  const bySign: PluggyDirection = outflowIsPositive
    ? tx.amount > 0 ? 'outflow' : 'inflow'
    : tx.amount < 0 ? 'outflow' : 'inflow';

  if (byType && byType !== bySign) {
    return {
      anomalyReason:
        `tx.type (${tx.type}) e o sinal do valor (${tx.amount}) discordam sobre a direção ` +
        `da transação em uma conta ${account.kind}.`,
    };
  }
  return { direction: byType ?? bySign };
}

export interface PluggyAccountLike {
  // Narrowed to the PluggyAccount schema's own enum: the sign convention in
  // deriveDirection branches on this, and a plain `string` would let anything
  // that is not 'CREDIT' silently take the BANK branch.
  kind: 'BANK' | 'CREDIT';
  cardBrand?: string | null;
  defaultPaymentType?: string | null;
}

export interface DerivedPaymentType {
  paymentType: string;
  cardBrand?: string;
}

const TRANSFER_METHODS = new Set(['TED', 'DOC', 'TRANSFER']);

// The ladder from the plan, first match wins. Voucher types
// (food-voucher/meal-voucher/fuel-voucher) are never derivable from Pluggy and
// are only ever set by hand in the review screen.
export function derivePaymentType(
  tx: Pick<PluggyTransactionApi, 'paymentData'>,
  account: PluggyAccountLike
): DerivedPaymentType {
  if (account.kind === 'CREDIT') {
    return { paymentType: 'credit', cardBrand: account.cardBrand ?? undefined };
  }

  const method = tx.paymentData?.paymentMethod ?? undefined;
  if (method === 'PIX') return { paymentType: 'pix' };
  if (method && TRANSFER_METHODS.has(method)) return { paymentType: 'debit' };
  if (method === 'BOLETO') return { paymentType: 'debit' };

  return { paymentType: account.defaultPaymentType ?? 'debit' };
}

export interface DerivedInstallments {
  current: number;
  total: number;
}

// Pluggy's installment metadata is far more trustworthy than the Caixa bill
// parser's regex guess, but it still goes through the exact same plausibility
// guard (isPlausibleInstallment, exported from billUtils.ts — re-implementing
// it here would be the duplication CLAUDE.md forbids) and the same
// MAX_INSTALLMENTS bound: one bad row must not expand into thousands of
// documents.
export function deriveInstallments(fields: {
  installmentCurrent?: number;
  installmentTotal?: number;
}): DerivedInstallments | undefined {
  const { installmentCurrent: current, installmentTotal: total } = fields;
  if (current === undefined || total === undefined) return undefined;
  if (!isPlausibleInstallment(current, total)) return undefined;
  if (total > MAX_INSTALLMENTS) return undefined;
  return { current, total };
}

export interface ShouldIgnoreContext {
  // accountId of every currently-linked PluggyAccount (any status), so an own
  // transfer can be recognized even when the counterparty leg belongs to a
  // disabled account.
  linkedAccountIds: ReadonlySet<string>;
}

export interface IgnoreRuleInput {
  tx: PluggyTransactionApi;
  account: PluggyAccountLike;
  direction: PluggyDirection;
  context: ShouldIgnoreContext;
}

export interface IgnoreRule {
  id: string;
  reason: string;
  test: (input: IgnoreRuleInput) => boolean;
}

// Description patterns vary by bank; matched loosely on purpose — missing one
// leaves a row in review (safe), matching one wrongly hides a real
// transaction (not safe), so a false negative is the failure to prefer.
const CARD_BILL_PATTERNS = [
  /PAGAMENTO\s+FATURA/i,
  /PAGTO\s+CART[AÃ]O/i,
  /PAGAMENTO\s+DE\s+CART[AÃ]O/i,
  /PAGAMENTO\s+CART[AÃ]O/i,
];

function ownDocumentsFromEnv(): Set<string> {
  const raw = process.env.PLUGGY_OWN_DOCUMENTS ?? '';
  return new Set(
    raw
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
  );
}

// The double-counting guard (plan step 10) — the highest-risk correctness item
// in the integration. A plain array, not a switch, so `statusReason` can name
// the rule that fired and the review screen can offer a one-click un-ignore
// per rule rather than one undifferentiated "ignored" bucket.
export const PLUGGY_IGNORE_RULES: IgnoreRule[] = [
  {
    id: 'credit-inflow',
    reason: 'Entrada em conta de cartão de crédito (pagamento de fatura ou estorno) — não é renda.',
    test: ({ account, direction }) => account.kind === 'CREDIT' && direction === 'inflow',
  },
  {
    id: 'card-bill-payment',
    reason: 'Pagamento de fatura de cartão — as compras já entram pela conta de crédito.',
    test: ({ account, direction, tx }) =>
      account.kind === 'BANK' &&
      direction === 'outflow' &&
      CARD_BILL_PATTERNS.some(pattern => pattern.test(tx.description ?? '')),
  },
  {
    id: 'own-transfer',
    reason: 'Transferência entre contas da própria família.',
    // Only the COUNTERPARTY side is checked, never both: the account holder's
    // own document is one leg of virtually every transaction (receiver on an
    // inflow, payer on an outflow) and is exactly what PLUGGY_OWN_DOCUMENTS
    // contains, so checking both legs would ignore a plain salary/PIX-in as
    // if it were a transfer. The transfer itself is still caught because it
    // posts as an outflow row on one linked account and an inflow row on the
    // other, each of which has the *other* household account as counterparty.
    test: ({ tx, direction, context }) => {
      const ownDocuments = ownDocumentsFromEnv();
      const counterpartyDoc =
        direction === 'outflow'
          ? (tx.paymentData?.receiver?.documentNumber ?? undefined)
          : (tx.paymentData?.payer?.documentNumber ?? undefined);
      if (counterpartyDoc && ownDocuments.has(counterpartyDoc)) {
        return true;
      }

      const counterpartyAccountId =
        direction === 'outflow'
          ? (tx.paymentData?.receiver?.accountId ?? undefined)
          : (tx.paymentData?.payer?.accountId ?? undefined);
      return !!counterpartyAccountId && context.linkedAccountIds.has(counterpartyAccountId);
    },
  },
];

export interface IgnoreOutcome {
  ignored: boolean;
  ruleId?: string;
  reason?: string;
}

// A Pluggy row's date is the POSTING date of the one installment it
// represents, not the original purchase date — buildExpenseDocuments walks
// forward from `date` treating it as installment 1, so a mid-series row must
// be backed off by (installmentCurrent - 1) months before being passed in.
// addMonthsClamped handles the negative offset correctly, and also clamps a
// day-31 anchor to the target month's last valid day, so the reconstruction
// is a purchase *month*, not a guaranteed exact calendar day.
export function anchorPurchaseDate(row: { date: string }, installments?: { current: number }): string {
  if (!installments) return row.date;
  return addMonthsClamped(row.date, -(installments.current - 1)).toISOString().split('T')[0];
}

export function shouldIgnore(
  tx: PluggyTransactionApi,
  account: PluggyAccountLike,
  direction: PluggyDirection,
  context: ShouldIgnoreContext
): IgnoreOutcome {
  for (const rule of PLUGGY_IGNORE_RULES) {
    if (rule.test({ tx, account, direction, context })) {
      return { ignored: true, ruleId: rule.id, reason: rule.reason };
    }
  }
  return { ignored: false };
}
