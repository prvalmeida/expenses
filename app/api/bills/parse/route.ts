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

// Coordinate-aware text reconstruction. Some statement PDFs are rendered glyph-by-glyph
// (each item is a single character), so the naive `item.str + ' '` join inserts a space
// between every letter and breaks the parsers. Instead, derive spacing from item geometry:
// insert a newline when y changes, and a space only when there is a real horizontal gap
// between consecutive items. This keeps glued glyphs as words while preserving the
// multi-space column separators (\s{2,}) the bill parsers rely on.
function reconstructPageText(
  items: Array<{ str: string; transform: number[]; width: number }>
): string {
  let out = '';
  let prevY: number | null = null;
  let prevEndX = 0;
  for (const it of items) {
    if (it.str === undefined || it.transform === undefined) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    const w = it.width ?? 0;
    if (prevY === null) {
      out += it.str;
    } else if (Math.abs(y - prevY) > 2) {
      out += '\n' + it.str; // new line (y changed)
    } else {
      const gap = x - prevEndX;
      const charW = w && it.str.length ? w / it.str.length : 3;
      if (gap > charW * 0.5) {
        const n = Math.min(Math.max(1, Math.round(gap / charW)), 6);
        out += ' '.repeat(n) + it.str; // real gap → space(s)
      } else {
        out += it.str; // glued glyphs → no space
      }
    }
    prevY = y;
    prevEndX = x + w;
  }
  return out;
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
      const pageText = reconstructPageText(
        content.items as Array<{ str: string; transform: number[]; width: number }>
      );
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
