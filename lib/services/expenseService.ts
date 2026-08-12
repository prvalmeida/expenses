import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import { computeEffectiveDate } from '../utils/cycleUtils';

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
