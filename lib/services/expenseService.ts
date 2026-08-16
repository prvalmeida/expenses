import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import { computeEffectiveDate } from '../utils/cycleUtils';
import { addMonthsClamped } from '../utils/dateUtils';

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
  for (let i = 1; i <= count; i++) {
    const date = addMonthsClamped(input.date, i - 1).toISOString().split('T')[0];
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

  const effectiveDate =
    isCredit && input.cardBrand && input.date
      ? await computeEffectiveDate(input.date, input.cardBrand, input.paymentType)
      : input.effectiveDate;

  const $set: Record<string, unknown> = {
    name: input.name,
    value: input.value,
    type: input.type,
    subtype: input.subtype,
    paymentType: input.paymentType,
    date: input.date,
    effectiveDate,
  };
  if (isCredit) $set.cardBrand = input.cardBrand;

  // Leaving cardBrand/installment/totalInstallments behind on a credit →
  // non-credit switch produces an OtherExpense that still looks like a card
  // purchase everywhere it is read.
  const update = isCredit
    ? { $set }
    : { $set, $unset: { cardBrand: '', installment: '', totalInstallments: '' } };

  return Expense.findByIdAndUpdate(id, update, { new: true });
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
