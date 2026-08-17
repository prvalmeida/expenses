import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '../../../../lib/api/respond';
import { importReceiptItems, ImportReceiptInput } from '../../../../lib/services/receiptService';

export async function POST(request: NextRequest) {
  try {
    const body: ImportReceiptInput = await request.json();
    const created = await importReceiptItems(body);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao importar gastos: ${error}` }, { status: 500 });
  }
}
