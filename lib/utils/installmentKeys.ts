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

// Whether every key is stored at least `occurrence` times — i.e. whether the
// series of the occurrence-th identical purchase is already fully booked.
export function seriesStored(
  keys: InstallmentSeriesKey[],
  stored: ReadonlyMap<string, number>,
  occurrence: number
): boolean {
  return keys.length > 0 && keys.every(key => (stored.get(installmentKeyId(key)) ?? 0) >= occurrence);
}
