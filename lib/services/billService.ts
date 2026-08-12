import path from 'path';
import { CardBrand, ParsedBillItem } from '@/types';
import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import { parseBillText, extractClosingDate, extractFullDueDate } from '../utils/billUtils';
import { ApiError } from '../api/respond';

export interface ParseBillInput {
  buffer: Uint8Array;
  cardBrand: CardBrand;
  // An external caller's statement is not necessarily locked with the
  // operator's CPF, so the password is a parameter; PDF_KEY is only the default.
  password?: string;
}

export interface ParseBillResult {
  items: ParsedBillItem[];
  cardBrand: CardBrand;
  closingDate: string | null;
  dueDate: string | null;
}

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

async function extractBillText(data: Uint8Array, password: string): Promise<string> {
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
      throw new ApiError('PDF_PASSWORD_REQUIRED', 'Senha do PDF incorreta');
    }
    throw err;
  }

  const pageTexts: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageTexts.push(
      reconstructPageText(content.items as Array<{ str: string; transform: number[]; width: number }>)
    );
  }

  return pageTexts.join('\n');
}

// Flags rows matching an already-stored (date, value) pair. Advisory only —
// the caller decides what to do with `isPossibleDuplicate`.
async function markDuplicates(parsed: ParsedBillItem[]): Promise<ParsedBillItem[]> {
  await connectToDatabase();
  const dates = [...new Set(parsed.map(i => i.date))];
  const existing = (await Expense.find({ date: { $in: dates } })
    .select('date value')
    .lean()) as { date: string; value: number }[];
  const existingKeys = new Set(existing.map(e => `${e.date}|${e.value}`));
  return parsed.map(item => ({
    ...item,
    isPossibleDuplicate: existingKeys.has(`${item.date}|${item.value}`),
  }));
}

export async function parseBill({
  buffer,
  cardBrand,
  password,
}: ParseBillInput): Promise<ParseBillResult> {
  const rawText = await extractBillText(buffer, password ?? process.env.PDF_KEY ?? '');

  if (!rawText.trim()) {
    throw new ApiError('DOCUMENT_UNREADABLE', 'PDF não contém texto extraível.');
  }

  const parsed = await parseBillText(rawText, cardBrand);
  const closingDate = extractClosingDate(rawText, cardBrand);
  const dueDate = extractFullDueDate(rawText);
  const items = await markDuplicates(parsed);

  return { items, cardBrand, closingDate, dueDate };
}
