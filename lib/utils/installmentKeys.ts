// One stored installment of a credit series, as the "already imported?" guards
// look it up in Expense. Shared by the bill import and the Pluggy import, so a
// series one of them stored is recognised by the other in either order.
//
// `name` is deliberately not part of the key: a series imported from a fatura
// PDF carries the parser's recovered text, never Pluggy's description, and a
// stored expense may have been renamed in Lançamentos since. Leaving it out
// means two genuinely different purchases with the same card, value, date and
// installment count share a key — which is why a guard never asks "does this
// key exist?" but "are there at least N of it?", N being how many identical
// purchases the caller already accounts for (see insertDedupedExpenseDocuments).
export interface InstallmentSeriesKey {
  value: number;
  date: string;
  cardBrand: string;
  installment: number;
  totalInstallments: number;
}

// The key of one expense document, or undefined when it is not part of a credit
// installment group. Only installments are ever deduped: overlapping bills and
// repeated Pluggy rows re-report the same parcela, while a single charge
// appearing twice is two charges. Reading the shape off the document itself
// (rather than trusting a caller's "is a group" flag) is what keeps a row the
// reviewer switched from credit to pix — a single document with no card or
// installment fields — from being matched on value + date alone.
export function installmentKey(document: {
  value: number;
  date: string;
  cardBrand?: string | null;
  installment?: number | null;
  totalInstallments?: number | null;
}): InstallmentSeriesKey | undefined {
  const { cardBrand, installment, totalInstallments } = document;
  if (!cardBrand || installment == null || totalInstallments == null || totalInstallments <= 1) {
    return undefined;
  }
  return { value: document.value, date: document.date, cardBrand, installment, totalInstallments };
}

// A stable string for counting keys in a Map.
export function installmentKeyId(key: InstallmentSeriesKey): string {
  return `${key.cardBrand}|${key.date}|${key.value}|${key.installment}/${key.totalInstallments}`;
}

// The key without its value: the slot an installment occupies in a series.
export function installmentSlotId(key: InstallmentSeriesKey): string {
  return `${key.cardBrand}|${key.date}|${key.installment}/${key.totalInstallments}`;
}

// How far apart two installment values may be and still be the same parcela.
// A purchase entered as a total (the form, the receipt import, POST
// /api/v1/expenses) is split evenly by buildExpenseDocuments — 100,00 in 3x is
// stored as 33,33 three times — while the bank puts the leftover cent on one
// installment (33,34 + 33,33 + 33,33). Matching exactly made such a series
// invisible to every guard, so the row it came from returned every month.
export const INSTALLMENT_VALUE_TOLERANCE = 0.01;

export function sameInstallmentValue(a: number, b: number): boolean {
  return Math.abs(Math.round(a * 100) - Math.round(b * 100)) <= Math.round(INSTALLMENT_VALUE_TOLERANCE * 100);
}

// How many complete copies of a series are stored — the fewest copies of any
// one installment. The series of the occurrence-th identical purchase is
// already fully booked when this is at least `occurrence`.
export function storedCopies(keys: InstallmentSeriesKey[], stored: ReadonlyMap<string, number>): number {
  if (keys.length === 0) return 0;
  return Math.min(...keys.map(key => stored.get(installmentKeyId(key)) ?? 0));
}
