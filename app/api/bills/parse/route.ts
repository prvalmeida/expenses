import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import { CardBrand } from '@/types';
import { parseBillText, extractClosingDate, extractFullDueDate } from '../../../../lib/utils/billUtils';
import connectToDatabase from '../../../../lib/mongodb';
import Expense from '../../../../lib/models/Expense';

// pdfjs-dist v5 legacy build ships ESM only; dynamic import is required for Node.js compatibility
// useWorkerFetch + isEvalSupported=false disables browser-only features
async function getPdfjs() {
  return import('pdfjs-dist/legacy/build/pdf.mjs');
}

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

    const cardBrand = cardBrandRaw as CardBrand;
    const password = process.env.PDF_KEY ?? '';

    const arrayBuffer = await file.arrayBuffer();
    const data = new Uint8Array(arrayBuffer);

    const pdfjsLib = await getPdfjs();

    const standardFontDataUrl = `file://${path.join(process.cwd(), 'node_modules/pdfjs-dist/standard_fonts')}/`;

    let pdf;
    try {
      const loadingTask = pdfjsLib.getDocument({
        data,
        password,
        useWorkerFetch: false,
        standardFontDataUrl,
      });
      pdf = await loadingTask.promise;
    } catch (err: unknown) {
      const isPasswordError =
        err instanceof Error &&
        (err.name === 'PasswordException' || err.message.toLowerCase().includes('password'));
      if (isPasswordError) {
        return NextResponse.json({ error: 'Senha do PDF incorreta' }, { status: 422 });
      }
      throw err;
    }

    const pageTexts: string[] = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = (content.items as Array<{ str: string; hasEOL: boolean }>)
        .map(item => item.str + (item.hasEOL ? '\n' : ' '))
        .join('');
      pageTexts.push(pageText);
    }

    const rawText = pageTexts.join('\n');

    if (!rawText.trim()) {
      return NextResponse.json(
        { error: 'PDF não contém texto extraível.' },
        { status: 400 }
      );
    }

    console.log(`Texto extraído do PDF: ${rawText}`);

    const parsed = await parseBillText(rawText, cardBrand);
    const closingDate = extractClosingDate(rawText, cardBrand);
    const dueDate = extractFullDueDate(rawText);

    await connectToDatabase();
    const dates = [...new Set(parsed.map(i => i.date))];
    const existing = await Expense.find({ date: { $in: dates } }).select('date value').lean() as { date: string; value: number }[];
    const existingKeys = new Set(existing.map(e => `${e.date}|${e.value}`));
    const items = parsed.map(item => ({
      ...item,
      isPossibleDuplicate: existingKeys.has(`${item.date}|${item.value}`),
    }));

    return NextResponse.json({ items, cardBrand, closingDate, dueDate });
  } catch (error) {
    return NextResponse.json({ error: `Falha ao processar fatura: ${error}` }, { status: 500 });
  }
}
