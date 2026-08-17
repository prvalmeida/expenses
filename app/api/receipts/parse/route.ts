import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '../../../../lib/api/respond';
import { parseReceiptFromPdf } from '../../../../lib/services/receiptService';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Arquivo PDF não enviado' }, { status: 400 });
    }

    const result = await parseReceiptFromPdf(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao processar nota: ${error}` }, { status: 500 });
  }
}
