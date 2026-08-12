import connectToDatabase from '../mongodb';
import Income from '../models/Income';

export interface IncomeInput {
  name: string;
  value: number;
  type: string;
  date: string;
}

export interface ListIncomesFilter {
  from?: string;
  to?: string;
  type?: string;
}

// Category validity is checked at the route boundary via validateIncomeType —
// it is a database question against a collection users edit at runtime, so it
// cannot be answered by a static schema and does not belong in here either.
export async function listIncomes(filter: ListIncomesFilter = {}) {
  await connectToDatabase();

  const query: Record<string, unknown> = {};
  if (filter.type) query.type = filter.type;
  if (filter.from || filter.to) {
    query.date = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lte: filter.to }),
    };
  }

  return Income.find(query).sort({ date: -1 });
}

export async function createIncome(input: IncomeInput) {
  await connectToDatabase();

  const income = new Income({
    name: input.name,
    value: input.value,
    type: input.type,
    date: input.date,
  });
  await income.save();
  return income;
}

export async function updateIncome(id: string, input: IncomeInput) {
  await connectToDatabase();

  return Income.findByIdAndUpdate(
    id,
    { $set: { name: input.name, value: input.value, type: input.type, date: input.date } },
    { new: true, runValidators: true }
  );
}

export async function deleteIncome(id: string) {
  await connectToDatabase();

  return Income.findByIdAndDelete(id);
}
