import { NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { Category } from '../../../../lib/models/Category';
import { ExpenseSubtypes, IncomeTypes } from '@/types';
import { invalidateCategoryCache } from '../../../../lib/utils/categoryUtils';

export async function POST() {
  try {
    await connectToDatabase();

    const expenseEntries = Object.entries(ExpenseSubtypes);
    const ops = [
      ...expenseEntries.map(([name, subtypes], index) =>
        Category.updateOne(
          { kind: 'expense', name },
          { $set: { subtypes: [...subtypes] }, $setOnInsert: { order: index } },
          { upsert: true }
        )
      ),
      ...IncomeTypes.map((name, index) =>
        Category.updateOne(
          { kind: 'income', name },
          { $set: { subtypes: [] }, $setOnInsert: { order: index } },
          { upsert: true }
        )
      ),
    ];

    await Promise.all(ops);
    invalidateCategoryCache();

    const [expense, income] = await Promise.all([
      Category.countDocuments({ kind: 'expense' }),
      Category.countDocuments({ kind: 'income' }),
    ]);

    return NextResponse.json({ seeded: true, expense, income });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao popular categorias: ${error}` }, { status: 500 });
  }
}
