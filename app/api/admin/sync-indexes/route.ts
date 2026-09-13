import { NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { Store } from '../../../../lib/models/Store';
import { ProductMapping } from '../../../../lib/models/ProductMapping';
import { Category } from '../../../../lib/models/Category';
import Expense from '../../../../lib/models/Expense';
import Income from '../../../../lib/models/Income';
import { PluggyItem } from '../../../../lib/models/PluggyItem';
import { PluggyAccount } from '../../../../lib/models/PluggyAccount';
import { PluggyTransaction } from '../../../../lib/models/PluggyTransaction';

export async function POST() {
  try {
    await connectToDatabase();

    const [
      storeResult,
      mappingResult,
      categoryResult,
      expenseResult,
      incomeResult,
      pluggyItemResult,
      pluggyAccountResult,
      pluggyTransactionResult,
    ] = await Promise.all([
      Store.syncIndexes(),
      ProductMapping.syncIndexes(),
      Category.syncIndexes(),
      Expense.syncIndexes(),
      Income.syncIndexes(),
      // PluggySyncLock needs no entry here: its only index is `_id`, already
      // unique with nothing to sync.
      PluggyItem.syncIndexes(),
      PluggyAccount.syncIndexes(),
      PluggyTransaction.syncIndexes(),
    ]);

    return NextResponse.json({
      store: storeResult,
      productMapping: mappingResult,
      category: categoryResult,
      expense: expenseResult,
      income: incomeResult,
      pluggyItem: pluggyItemResult,
      pluggyAccount: pluggyAccountResult,
      pluggyTransaction: pluggyTransactionResult,
    });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao sincronizar indexes: ${error}` }, { status: 500 });
  }
}
