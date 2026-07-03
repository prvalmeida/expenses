import { NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { Store } from '../../../../lib/models/Store';
import { ProductMapping } from '../../../../lib/models/ProductMapping';
import { Category } from '../../../../lib/models/Category';

export async function POST() {
  try {
    await connectToDatabase();

    const [storeResult, mappingResult, categoryResult] = await Promise.all([
      Store.syncIndexes(),
      ProductMapping.syncIndexes(),
      Category.syncIndexes(),
    ]);

    return NextResponse.json({
      store: storeResult,
      productMapping: mappingResult,
      category: categoryResult,
    });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao sincronizar indexes: ${error}` }, { status: 500 });
  }
}
