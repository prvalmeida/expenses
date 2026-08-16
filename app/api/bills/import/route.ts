import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '../../../../lib/api/respond';
import { importBillItems, ImportBillInput } from '../../../../lib/services/billService';

export async function POST(request: NextRequest) {
  try {
    const body: ImportBillInput = await request.json();
    const result = await importBillItems(body);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao importar fatura: ${error}` }, { status: 500 });
  }
}
