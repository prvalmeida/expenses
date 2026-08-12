import { createRequire } from 'module';
import { ConfirmedReceiptItem } from '@/types';
import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import { ProductMapping } from '../models/ProductMapping';
import { Store } from '../models/Store';
import { computeEffectiveDate } from '../utils/cycleUtils';
import { addMonthsClamped } from '../utils/dateUtils';
import { getExpenseCategories } from '../utils/categoryUtils';
import { interpretAndCrossReference, ParseResponse } from '../utils/receiptUtils';
import { ApiError } from '../api/respond';

const require = createRequire(import.meta.url);
type PdfData = { text: string; numpages: number };
const pdfParse: (buffer: Buffer) => Promise<PdfData> = require('pdf-parse');

const ALLOWED_KEYWORDS = ['sefaz', 'nfce', 'nfe', 'dfe'];
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1500;
const MIN_RECEIPT_TEXT_LENGTH = 200;

export interface ImportReceiptInput {
  cnpj: string;
  address?: string;
  date: string;
  paymentType: string;
  cardBrand?: string;
  items: ConfirmedReceiptItem[];
  newMappings?: ConfirmedReceiptItem[];
  storeDefaultType?: string;
  installments?: number;
}

// SSRF guard: this runs on a path an authenticated external caller can reach,
// so the allowlist must stay on the service, not be re-approximated per route.
export function isAllowedSefazUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    return (
      url.protocol === 'https:' &&
      url.hostname.endsWith('.gov.br') &&
      ALLOWED_KEYWORDS.some(kw => url.hostname.includes(kw))
    );
  } catch {
    return false;
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(parseInt(code)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchReceiptText(url: string): Promise<{ text: string; httpStatus: number }> {
  const response = await fetch(url, {
    headers: {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'pt-BR,pt;q=0.9',
    },
  });

  if (!response.ok) return { text: '', httpStatus: response.status };

  // Detect charset — some state portals still serve ISO-8859-1
  const contentType = response.headers.get('content-type') ?? '';
  const charsetMatch = contentType.match(/charset=([^\s;]+)/i);
  const charset = charsetMatch?.[1] ?? 'utf-8';

  const buffer = await response.arrayBuffer();
  const html = new TextDecoder(charset).decode(buffer);
  return { text: htmlToText(html), httpStatus: 200 };
}

export async function parseReceiptFromPdf(buffer: Buffer): Promise<ParseResponse> {
  const parsed = await pdfParse(buffer);

  if (!parsed.text.trim()) {
    throw new ApiError(
      'DOCUMENT_UNREADABLE',
      'PDF não contém texto extraível. Possível PDF escaneado sem OCR.'
    );
  }

  return interpretAndCrossReference(parsed.text);
}

export async function parseReceiptFromUrl(url: string): Promise<ParseResponse> {
  if (!isAllowedSefazUrl(url)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      'URL não permitida. Informe um link de portal SEFAZ (domínio *.gov.br contendo sefaz, nfce, nfe ou dfe).'
    );
  }

  // SEFAZ portals sometimes return a short "loading" page on the first request
  // and cache the actual content for subsequent ones — retry with a delay.
  // Network errors (DNS, TLS) on first attempt are also retried.
  let fetchResult = { text: '', httpStatus: 0 };
  let lastFetchError: unknown = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await new Promise(res => setTimeout(res, RETRY_DELAY_MS));
    try {
      fetchResult = await fetchReceiptText(url);
      lastFetchError = null;
      if (fetchResult.httpStatus !== 200) break; // HTTP error — retry won't help
      if (fetchResult.text.length >= MIN_RECEIPT_TEXT_LENGTH) break; // sufficient content — done
    } catch (err) {
      lastFetchError = err;
      // network error (DNS, TLS, connection reset) — retry on next iteration
    }
  }

  if (lastFetchError) {
    throw new ApiError('UPSTREAM_FAILED', `Falha ao acessar o portal: ${lastFetchError}`);
  }

  if (fetchResult.httpStatus !== 200) {
    throw new ApiError(
      'UPSTREAM_FAILED',
      `Portal retornou HTTP ${fetchResult.httpStatus}. Verifique se o link está correto.`
    );
  }

  if (fetchResult.text.length < MIN_RECEIPT_TEXT_LENGTH) {
    throw new ApiError(
      'DOCUMENT_UNREADABLE',
      'Conteúdo insuficiente extraído. O portal pode exigir JavaScript ou a nota está indisponível.'
    );
  }

  return interpretAndCrossReference(fetchResult.text);
}

export async function importReceiptItems(input: ImportReceiptInput) {
  await connectToDatabase();

  const { cnpj, address, date, paymentType, cardBrand, items, newMappings, storeDefaultType } = input;
  const installmentCount = Math.max(1, Math.round(input.installments ?? 1));

  if (!cnpj || !date || !paymentType || !items?.length) {
    throw new ApiError('VALIDATION_FAILED', 'cnpj, date, paymentType e items são obrigatórios');
  }

  const categories = await getExpenseCategories();
  const subtypesByType = new Map(categories.map(c => [c.name, new Set(c.subtypes)]));
  const isValidPair = (type: string, subtype?: string) => {
    const subs = subtypesByType.get(type);
    if (!subs) return false;
    return !subtype || subs.has(subtype);
  };
  const invalid = [...items, ...(newMappings ?? [])].find(item => !isValidPair(item.type, item.subtype));
  if (invalid) {
    throw new ApiError(
      'INVALID_CATEGORY',
      `Categoria ou subcategoria inválida: ${invalid.type}${invalid.subtype ? ` / ${invalid.subtype}` : ''}`
    );
  }

  const storeAddress = address ?? null;

  if (newMappings?.length) {
    await Promise.all(
      newMappings.map(item =>
        ProductMapping.updateOne(
          { cnpj, address: storeAddress, description: item.description.toLowerCase().trim() },
          { $set: { type: item.type, subtype: item.subtype } },
          { upsert: true }
        )
      )
    );
  }

  if (storeDefaultType) {
    await Store.updateOne(
      { cnpj, address: storeAddress },
      { $set: { defaultType: storeDefaultType } }
    );
  }

  const installDates: string[] = [];
  const effectiveDates: string[] = [];
  for (let i = 0; i < installmentCount; i++) {
    const d = addMonthsClamped(date, i);
    const dateStr = d.toISOString().substring(0, 10);
    installDates.push(dateStr);
    effectiveDates.push(await computeEffectiveDate(dateStr, cardBrand ?? '', paymentType));
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const expenses = items.flatMap(item => {
    const txId = crypto.randomUUID();
    const perValue = round2(item.value / installmentCount);
    return Array.from({ length: installmentCount }, (_, i) => ({
      name: item.description,
      value: perValue,
      type: item.type,
      subtype: item.subtype,
      paymentType,
      date: installDates[i],
      effectiveDate: effectiveDates[i],
      ...(item.qty !== undefined && { qty: item.qty }),
      ...(item.unit && { unit: item.unit }),
      ...(paymentType === 'credit' && {
        cardBrand,
        installment: i + 1,
        totalInstallments: installmentCount,
        transactionId: txId,
      }),
    }));
  });

  return Expense.insertMany(expenses);
}
