import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '../../../../lib/api/respond';
import { parseReceiptFromUrl } from '../../../../lib/services/receiptService';

export async function POST(request: NextRequest) {
  try {
    const { url } = await request.json();

    if (!url || typeof url !== 'string') {
      return NextResponse.json({ error: 'URL não informada' }, { status: 400 });
    }

    const result = await parseReceiptFromUrl(url);
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao processar link: ${error}` }, { status: 500 });
  }
}
