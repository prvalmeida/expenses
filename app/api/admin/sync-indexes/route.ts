import { NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import { Store } from '../../../../lib/models/Store';
import { ProductMapping } from '../../../../lib/models/ProductMapping';

export async function POST() {
  try {
    await connectToDatabase();

    const [storeResult, mappingResult] = await Promise.all([
      Store.syncIndexes(),
      ProductMapping.syncIndexes(),
    ]);

    return NextResponse.json({
      store: storeResult,
      productMapping: mappingResult,
    });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao sincronizar indexes: ${error}` }, { status: 500 });
  }
}
