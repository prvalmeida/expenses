import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import { computeEffectiveDate } from '../utils/cycleUtils';
import { installmentDates } from '../utils/dateUtils';
import {
  INSTALLMENT_VALUE_TOLERANCE,
  InstallmentSeriesKey,
  installmentKey,
  installmentKeyId,
  installmentSlotId,
  sameInstallmentValue,
} from '../utils/installmentKeys';

// A value range wide enough for sameInstallmentValue, with float slack.
function valueRange(value: number) {
  const slack = INSTALLMENT_VALUE_TOLERANCE + 0.005;
  return { $gte: value - slack, $lte: value + slack };
}

// One logical purchase. `installments` and `valueIsTotal` only mean anything for
// a credit purchase; the schema's discriminated union is what keeps a non-credit
// caller from sending them.
export interface CreateExpenseInput {
  name: string;
  value: number;
  type: string;
  subtype?: string;
  paymentType: string;
  cardBrand?: string;
  date: string;
  installments?: number;
  // `value` is the total of the purchase by default. A caller echoing a bill
  // row back, where each row already carries one installment's amount, sets
  // false — the flag changes what the number means, so it is explicit.
  valueIsTotal?: boolean;
}

export interface ExpenseDocument {
  name: string;
  value: number;
  type: string;
  subtype?: string;
  paymentType: string;
  date: string;
  effectiveDate: string;
  cardBrand?: string;
  installment?: number;
  totalInstallments?: number;
  transactionId?: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// The single source of truth for installment expansion: one purchase in, the N
// documents it becomes out. effectiveDate is derived per installment through
// computeEffectiveDate rather than by offsetting the first one, so a CardCycle
// override on a later month is honoured instead of silently ignored.
//
// Returns documents rather than persisting them: the bill import has to check
// each row against what is already stored before inserting it.
export async function buildExpenseDocuments(
  input: CreateExpenseInput
): Promise<ExpenseDocument[]> {
  await connectToDatabase();

  const isCredit = input.paymentType === 'credit';
  const count = isCredit ? Math.max(1, Math.round(input.installments ?? 1)) : 1;
  const perValue =
    input.valueIsTotal === false ? input.value : round2(input.value / count);
  const transactionId = isCredit ? crypto.randomUUID() : undefined;

  const documents: ExpenseDocument[] = [];
  for (const [index, date] of installmentDates(input.date, count).entries()) {
    const i = index + 1;
    documents.push({
      name: input.name,
      value: perValue,
      type: input.type,
      ...(input.subtype && { subtype: input.subtype }),
      paymentType: input.paymentType,
      date,
      effectiveDate: await computeEffectiveDate(date, input.cardBrand ?? '', input.paymentType),
      ...(isCredit && {
        cardBrand: input.cardBrand,
        installment: i,
        totalInstallments: count,
        transactionId,
      }),
    });
  }

  return documents;
}

// How many stored expenses match each installment key (by installmentKeyId), in
// one query — the guards below run per staged row inside the Pluggy sync lock,
// and a findOne per installment was N sequential round trips per row on every
// sync. A value a cent off still matches (see sameInstallmentValue).
export async function countStoredInstallments(
  keys: InstallmentSeriesKey[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (keys.length === 0) return counts;

  await connectToDatabase();
  const docs = await Expense.find(
    { $or: keys.map(key => ({ ...key, value: valueRange(key.value) })) },
    'value date cardBrand installment totalInstallments'
  ).lean<{ value: number; date: string; cardBrand?: string; installment?: number; totalInstallments?: number }[]>();

  const storedBySlot = new Map<string, number[]>();
  for (const doc of docs) {
    const key = installmentKey(doc);
    if (!key) continue;
    const slot = installmentSlotId(key);
    storedBySlot.set(slot, [...(storedBySlot.get(slot) ?? []), key.value]);
  }
  for (const key of keys) {
    const values = storedBySlot.get(installmentSlotId(key)) ?? [];
    counts.set(installmentKeyId(key), values.filter(value => sameInstallmentValue(value, key.value)).length);
  }
  return counts;
}

// The dates of the stored expenses at one position of a series (same card,
// value give or take a cent, and installment count) dated inside [dateFrom,
// dateTo]. `date` is YYYY-MM-DD, so the range is a lexical comparison.
export async function storedInstallmentDates(query: {
  value: number;
  cardBrand: string;
  installment: number;
  totalInstallments: number;
  dateFrom: string;
  dateTo: string;
}): Promise<string[]> {
  await connectToDatabase();
  const { dateFrom, dateTo, value, ...position } = query;
  const docs = await Expense.find(
    { ...position, value: valueRange(value), date: { $gte: dateFrom, $lte: dateTo } },
    'value date'
  ).lean<{ value: number; date: string }[]>();
  return docs.filter(doc => sameInstallmentValue(doc.value, value)).map(doc => doc.date);
}

// Inserts the documents of one purchase, skipping each installment already
// stored — the single dedupe both the bill import and the Pluggy import use, so
// a series booked by one is recognised by the other in either order.
//
// `occurrence` is which of several identical purchases (same card, value, date
// and installment count) this one is, 1-based: an installment is skipped only
// when at least that many copies are already stored. The key carries no
// `name` (see installmentKeys.ts), so without the count the second of two real
// identical purchases would match the first's series and be silently dropped.
export async function insertDedupedExpenseDocuments(
  documents: ExpenseDocument[],
  occurrence = 1
): Promise<{ importedIds: string[]; skippedExisting: number }> {
  const keys = documents.map(document => installmentKey(document));
  const stored = await countStoredInstallments(keys.filter(key => key !== undefined));

  const importedIds: string[] = [];
  let skippedExisting = 0;
  for (const [i, document] of documents.entries()) {
    const key = keys[i];
    if (key && (stored.get(installmentKeyId(key)) ?? 0) >= occurrence) {
      skippedExisting++;
      continue;
    }
    const created = await Expense.create(document);
    importedIds.push(String(created._id));
  }

  return { importedIds, skippedExisting };
}

export async function createExpenses(input: CreateExpenseInput) {
  const documents = await buildExpenseDocuments(input);
  return Expense.insertMany(documents);
}

// The eight editable fields. `transactionId`, `installment` and
// `totalInstallments` are never accepted from an edit — an installment group is
// reshaped by re-importing, not by patching one of its records.
export interface UpdateExpenseInput {
  name: string;
  value: number;
  type: string;
  subtype?: string | null;
  paymentType: string;
  cardBrand?: string | null;
  date: string;
  effectiveDate?: string;
}

export interface ListExpensesFilter {
  // Mirrors the Dashboard's "DATA DA COMPRA" / "FLUXO DE CAIXA" toggle: the same
  // record belongs to a different month depending on which date you ask about.
  dateField?: 'date' | 'effectiveDate';
  from?: string;
  to?: string;
  type?: string;
  subtype?: string;
  paymentType?: string;
  cardBrand?: string;
  transactionId?: string;
  limit?: number;
  cursor?: string;
}

export type StoredExpense = ExpenseDocument & { _id: string };

export interface ListExpensesResult {
  items: StoredExpense[];
  nextCursor: string | null;
}

// Keyset pagination, not skip/limit: an offset walk re-reads everything it
// skipped and shifts under concurrent writes. The cursor is the last returned
// _id; its sort value is read back so the tie-break stays correct when several
// records share a date.
export async function listExpenses(filter: ListExpensesFilter = {}): Promise<ListExpensesResult> {
  await connectToDatabase();

  const dateField = filter.dateField ?? 'date';
  const limit = filter.limit ?? 100;

  const query: Record<string, unknown> = {};
  if (filter.type) query.type = filter.type;
  if (filter.subtype) query.subtype = filter.subtype;
  if (filter.paymentType) query.paymentType = filter.paymentType;
  if (filter.cardBrand) query.cardBrand = filter.cardBrand;
  if (filter.transactionId) query.transactionId = filter.transactionId;
  if (filter.from || filter.to) {
    query[dateField] = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lte: filter.to }),
    };
  }

  if (filter.cursor) {
    const anchor = await Expense.findById(filter.cursor).select(dateField).lean<{ [k: string]: string }>();
    // A cursor pointing at a deleted record yields no page rather than
    // silently restarting from the top.
    if (!anchor) return { items: [], nextCursor: null };
    query.$or = [
      { [dateField]: { $lt: anchor[dateField] } },
      { [dateField]: anchor[dateField], _id: { $lt: filter.cursor } },
    ];
  }

  // One extra row is fetched to tell "page is full" from "there is more".
  const docs = await Expense.find(query)
    .sort({ [dateField]: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;

  return {
    items: items as unknown as StoredExpense[],
    nextCursor: hasMore ? String(items[items.length - 1]._id) : null,
  };
}

export async function getExpense(id: string) {
  await connectToDatabase();
  return Expense.findById(id);
}

export async function listExpenseGroup(transactionId: string) {
  await connectToDatabase();
  return Expense.find({ transactionId }).sort({ installment: 1 });
}

export type DeleteScope = 'single' | 'group';

export interface DeleteExpenseResult {
  scope: DeleteScope;
  deletedCount: number;
}

// Input is expected to have passed schema validation and validateExpensePair at
// the route boundary; the service checks shape no further. It does re-derive
// effectiveDate rather than trusting the caller's, so a credit expense can
// never carry a due date that disagrees with the card's cycle.
export async function updateExpense(id: string, input: UpdateExpenseInput) {
  await connectToDatabase();

  const isCredit = input.paymentType === 'credit';

  // For a non-credit expense the two dates must agree — falling back to the
  // stored effectiveDate would leave a record whose purchase date moved sitting
  // in one month under "DATA DA COMPRA" and another under "FLUXO DE CAIXA".
  const effectiveDate =
    isCredit && input.cardBrand && input.date
      ? await computeEffectiveDate(input.date, input.cardBrand, input.paymentType)
      : (input.effectiveDate ?? input.date);

  const $set: Record<string, unknown> = {
    name: input.name,
    value: input.value,
    type: input.type,
    paymentType: input.paymentType,
    date: input.date,
    effectiveDate,
  };

  // Mongoose drops undefined keys from an update, so assigning them is not a
  // clear — an omitted subtype would silently keep the stored one and orphan it
  // against the new type. The fields an edit may drop are $unset explicitly.
  const $unset: Record<string, ''> = {};
  if (input.subtype == null) $unset.subtype = '';
  else $set.subtype = input.subtype;

  // Leaving cardBrand/installment/totalInstallments behind on a credit →
  // non-credit switch produces an OtherExpense that still looks like a card
  // purchase everywhere it is read.
  if (isCredit) $set.cardBrand = input.cardBrand;
  else Object.assign($unset, { cardBrand: '', installment: '', totalInstallments: '' });

  // Mongo rejects an empty $unset, which is what a credit edit that keeps its
  // subtype produces.
  const update = Object.keys($unset).length ? { $set, $unset } : { $set };

  return Expense.findByIdAndUpdate(id, update, { new: true });
}

// A PATCH is resolved against the stored record before anything is validated or
// written, so the category check at the boundary sees the same merged values the
// write will use — validating the patch alone would let `{ subtype }` land on a
// type it does not belong to.
export async function resolveExpensePatch(
  id: string,
  patch: Partial<UpdateExpenseInput>
): Promise<UpdateExpenseInput | null> {
  const existing = await getExpense(id);
  if (!existing) return null;

  const current: UpdateExpenseInput = {
    name: existing.name,
    value: existing.value,
    type: existing.type,
    subtype: existing.subtype,
    paymentType: existing.paymentType,
    cardBrand: existing.cardBrand,
    date: existing.date,
    effectiveDate: existing.effectiveDate,
  };

  const merged = { ...current, ...patch };

  // A patched `date` invalidates the stored effectiveDate. updateExpense
  // re-derives it for a credit expense, but for any other payment type it would
  // keep the merged-in stale value; dropping it here lets the same fallback
  // apply to both paths.
  if (patch.date && patch.effectiveDate === undefined) merged.effectiveDate = undefined;

  return merged;
}

export async function deleteExpenseGroup(transactionId: string): Promise<DeleteExpenseResult | null> {
  await connectToDatabase();

  const { deletedCount } = await Expense.deleteMany({ transactionId });
  if (deletedCount === 0) return null;

  return { scope: 'group', deletedCount };
}

export async function deleteExpense(
  id: string,
  { allInstallments = false }: { allInstallments?: boolean } = {}
): Promise<DeleteExpenseResult | null> {
  await connectToDatabase();

  const expense = await Expense.findById(id);
  if (!expense) return null;

  if (allInstallments && expense.transactionId) {
    const { deletedCount } = await Expense.deleteMany({ transactionId: expense.transactionId });
    return { scope: 'group', deletedCount };
  }

  await Expense.findByIdAndDelete(id);
  return { scope: 'single', deletedCount: 1 };
}
