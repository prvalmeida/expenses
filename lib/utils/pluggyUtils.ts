import { PluggyTransactionApi } from '../pluggy/client';

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
export function deriveDirection(tx: Pick<PluggyTransactionApi, 'type' | 'amount'>): DirectionResult {
  const byType: PluggyDirection | undefined =
    tx.type === 'DEBIT' ? 'outflow' : tx.type === 'CREDIT' ? 'inflow' : undefined;
  const bySign: PluggyDirection = tx.amount < 0 ? 'outflow' : 'inflow';

  if (byType && byType !== bySign) {
    return {
      anomalyReason: `tx.type (${tx.type}) e o sinal do valor (${tx.amount}) discordam sobre a direção da transação.`,
    };
  }
  return { direction: byType ?? bySign };
}

export interface PluggyAccountLike {
  kind: string;
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
