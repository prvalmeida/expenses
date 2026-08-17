import { NextRequest, NextResponse } from 'next/server';
import { CardBrand } from '@/types';
import { ApiError, ERROR_STATUS } from '../../../../lib/api/respond';
import { parseBill } from '../../../../lib/services/billService';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const cardBrandRaw = formData.get('cardBrand') as string | null;

    if (!file) {
      return NextResponse.json({ error: 'Arquivo PDF não enviado' }, { status: 400 });
    }

    const validCardBrands = Object.values(CardBrand) as string[];
    if (!cardBrandRaw || !validCardBrands.includes(cardBrandRaw)) {
      return NextResponse.json(
        { error: `Cartão inválido. Valores aceitos: ${validCardBrands.join(', ')}` },
        { status: 400 }
      );
    }

    const result = await parseBill({
      buffer: new Uint8Array(await file.arrayBuffer()),
      cardBrand: cardBrandRaw as CardBrand,
    });

    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao processar fatura: ${error}` }, { status: 500 });
  }
}
