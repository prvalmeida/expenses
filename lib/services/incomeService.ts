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
  // Omitted by the internal UI route, which needs the whole list to total it
  // client-side. The v1 schema always supplies a bounded default.
  limit?: number;
  cursor?: string;
}

export interface ListIncomesResult {
  items: Record<string, unknown>[];
  nextCursor: string | null;
}

// Category validity is checked at the route boundary via validateIncomeType —
// it is a database question against a collection users edit at runtime, so it
// cannot be answered by a static schema and does not belong in here either.
export async function listIncomes(filter: ListIncomesFilter = {}): Promise<ListIncomesResult> {
  await connectToDatabase();

  const query: Record<string, unknown> = {};
  if (filter.type) query.type = filter.type;
  if (filter.from || filter.to) {
    query.date = {
      ...(filter.from && { $gte: filter.from }),
      ...(filter.to && { $lte: filter.to }),
    };
  }

  // Same keyset scheme as listExpenses: the cursor's sort value is read back so
  // records sharing a date keep a stable tie-break.
  if (filter.cursor) {
    const anchor = await Income.findById(filter.cursor).select('date').lean<{ date: string }>();
    if (!anchor) return { items: [], nextCursor: null };
    query.$or = [
      { date: { $lt: anchor.date } },
      { date: anchor.date, _id: { $lt: filter.cursor } },
    ];
  }

  const cursorQuery = Income.find(query).sort({ date: -1, _id: -1 });
  if (filter.limit === undefined) return { items: await cursorQuery, nextCursor: null };

  const docs = await cursorQuery.limit(filter.limit + 1);
  const hasMore = docs.length > filter.limit;
  const items = hasMore ? docs.slice(0, filter.limit) : docs;

  return { items, nextCursor: hasMore ? String(items[items.length - 1]._id) : null };
}

export async function getIncome(id: string) {
  await connectToDatabase();
  return Income.findById(id);
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
