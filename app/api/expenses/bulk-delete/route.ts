import { NextRequest, NextResponse } from 'next/server';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';

export async function POST(request: NextRequest) {
  try {
    await connectToDatabase();
    const { ids }: { ids: string[] } = await request.json();

    if (!ids?.length) {
      return NextResponse.json({ error: 'ids é obrigatório' }, { status: 400 });
    }

    const result = await Expense.deleteMany({ _id: { $in: ids } });
    return NextResponse.json({ deleted: result.deletedCount }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao excluir: ${error}` }, { status: 500 });
  }
}
