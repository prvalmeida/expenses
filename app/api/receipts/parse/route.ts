import { NextRequest, NextResponse } from 'next/server';
import { createRequire } from 'module';
import { interpretAndCrossReference } from '../../../../lib/utils/receiptUtils';

const require = createRequire(import.meta.url);
type PdfData = { text: string; numpages: number };
const pdfParse: (buffer: Buffer) => Promise<PdfData> = require('pdf-parse');

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return NextResponse.json({ error: 'Arquivo PDF não enviado' }, { status: 400 });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await pdfParse(buffer);

    if (!parsed.text.trim()) {
      return NextResponse.json(
        { error: 'PDF não contém texto extraível. Possível PDF escaneado sem OCR.' },
        { status: 400 }
      );
    }

    const result = await interpretAndCrossReference(parsed.text);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: `Falha ao processar nota: ${error}` }, { status: 500 });
  }
}
