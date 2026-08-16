import { NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { Store } from '../../../../lib/models/Store';
import { ProductMapping } from '../../../../lib/models/ProductMapping';
import { Category } from '../../../../lib/models/Category';
import Expense from '../../../../lib/models/Expense';
import Income from '../../../../lib/models/Income';

export async function POST() {
  try {
    await connectToDatabase();

    const [storeResult, mappingResult, categoryResult, expenseResult, incomeResult] =
      await Promise.all([
        Store.syncIndexes(),
        ProductMapping.syncIndexes(),
        Category.syncIndexes(),
        Expense.syncIndexes(),
        Income.syncIndexes(),
      ]);

    return NextResponse.json({
      store: storeResult,
      productMapping: mappingResult,
      category: categoryResult,
      expense: expenseResult,
      income: incomeResult,
    });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao sincronizar indexes: ${error}` }, { status: 500 });
  }
}
