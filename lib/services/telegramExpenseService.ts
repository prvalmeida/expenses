import { ZodError } from 'zod';
import { createExpenseSchema, CreateExpenseBody } from '@/lib/api/schemas/expense';
import { ApiErrorDetails } from '@/lib/api/respond';
import { CardBrand } from '@/types';

const FIELD_ALIASES = new Map<string, keyof DraftExpense>([
  ['nome', 'name'],
  ['descricao', 'name'],
  ['descrição', 'name'],
  ['desc', 'name'],
  ['valor', 'value'],
  ['preco', 'value'],
  ['preço', 'value'],
  ['categoria', 'type'],
  ['tipo', 'type'],
  ['subcategoria', 'subtype'],
  ['subtipo', 'subtype'],
  ['pagamento', 'paymentType'],
  ['pagto', 'paymentType'],
  ['forma', 'paymentType'],
  ['forma de pagamento', 'paymentType'],
  ['data', 'date'],
  ['cartao', 'cardBrand'],
  ['cartão', 'cardBrand'],
  ['cartao de credito', 'cardBrand'],
  ['cartão de crédito', 'cardBrand'],
  ['bandeira', 'cardBrand'],
  ['parcelas', 'installments'],
]);

// Maps, not object literals: a literal like { credit: 'credit' } resolves
// "constructor" through the prototype chain (truthy — an Object function),
// dodging the friendly invalid-payment error for a garbage key. Map.get has
// no prototype to leak through.
const PAYMENT_TYPE_ALIASES = new Map<string, CreateExpenseBody['paymentType']>([
  ['credit', 'credit'],
  ['credito', 'credit'],
  ['crédito', 'credit'],
  ['cash', 'cash'],
  ['dinheiro', 'cash'],
  ['especie', 'cash'],
  ['espécie', 'cash'],
  ['debit', 'debit'],
  ['debito', 'debit'],
  ['débito', 'debit'],
  ['pix', 'pix'],
  ['vale alimentacao', 'food-voucher'],
  ['vale alimentação', 'food-voucher'],
  ['alimentacao', 'food-voucher'],
  ['alimentação', 'food-voucher'],
  ['vale refeicao', 'meal-voucher'],
  ['vale refeição', 'meal-voucher'],
  ['refeicao', 'meal-voucher'],
  ['refeição', 'meal-voucher'],
  ['vale combustivel', 'fuel-voucher'],
  ['vale combustível', 'fuel-voucher'],
  ['combustivel', 'fuel-voucher'],
  ['combustível', 'fuel-voucher'],
]);

const CARD_BRAND_ALIASES = new Map<string, CreateExpenseBody['cardBrand']>([
  ['master santander', CardBrand.MasterSantander],
  ['master', CardBrand.MasterSantander],
  ['mastercard', CardBrand.MasterSantander],
  ['visa caixa', CardBrand.Visa],
  ['visa', CardBrand.Visa],
  ['elo caixa', CardBrand.EloCaixa],
  ['elo', CardBrand.EloCaixa],
]);

type DraftExpense = {
  name?: string;
  value?: string;
  type?: string;
  subtype?: string;
  paymentType?: string;
  date?: string;
  cardBrand?: string;
  installments?: string;
};

type ParseSuccess = {
  success: true;
  expense: CreateExpenseBody;
  ignoredLines: string[];
  recognizedFields: string[];
};

type ParseFailure = {
  success: false;
  details: ApiErrorDetails;
  ignoredLines: string[];
  recognizedFields: string[];
};

export type TelegramExpenseParseResult = ParseSuccess | ParseFailure;

function fold(input: string): string {
  return input
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

function toDetails(error: ZodError): ApiErrorDetails {
  const details: ApiErrorDetails = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

function todayIso(now = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function offsetIso(base: string, days: number): string {
  const date = new Date(`${base}T12:00:00`);
  date.setDate(date.getDate() + days);
  return todayIso(date);
}

// Strict pt-BR money grammar, applied before any conversion — the same
// discipline as BRL_AMOUNT guarding parseBRLAmount in the bill parsers, but
// for free-form text where nothing guarantees the shape. A dot-decimal
// "42.90" is ambiguous (en-US 42.9 vs a typo'd pt-BR 42,90) and must be
// rejected, never guessed: the old strip-every-dot code turned it into 4290,
// a silent 100x corruption that sailed through brlAmount.
const AMOUNT_GRAMMAR = /^(?:r\$\s*)?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)$/i;

function parseAmount(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.trim().match(AMOUNT_GRAMMAR);
  if (!match) return undefined;
  return Number(match[1].replace(/\./g, '').replace(',', '.'));
}

function parseInstallments(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\d+/);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isInteger(value) ? value : undefined;
}

// A shape-only regex accepts "2026-13-31" and "31/02/2026"; downstream, the
// credit flow feeds that month into getCycle, whose Date.UTC overflows
// silently into the next year. Date.UTC normalizes overflow, so a round-trip
// equality is a real calendar check — month 1-12, day valid for the month,
// leap years included.
function toIsoDate(year: number, month: number, day: number): string | undefined {
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return undefined;
  }
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function parseDate(raw: string | undefined, baseToday: string): string | undefined {
  if (!raw) return baseToday;
  const normalized = fold(raw);
  if (normalized === 'hoje') return baseToday;
  if (normalized === 'ontem') return offsetIso(baseToday, -1);
  if (normalized === 'amanha') return offsetIso(baseToday, 1);

  const trimmed = raw.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return toIsoDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const br = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return toIsoDate(Number(br[3]), Number(br[2]), Number(br[1]));
  return undefined;
}

function parsePaymentType(raw?: string): CreateExpenseBody['paymentType'] | undefined {
  if (!raw) return undefined;
  return PAYMENT_TYPE_ALIASES.get(fold(raw));
}

function parseCardBrand(raw?: string): CreateExpenseBody['cardBrand'] | undefined {
  if (!raw) return undefined;
  return CARD_BRAND_ALIASES.get(fold(raw));
}

function splitTypeAndSubtype(rawType?: string, rawSubtype?: string) {
  if (!rawType) return { type: rawType, subtype: rawSubtype };
  const match = rawType.split('/').map(part => part.trim()).filter(Boolean);
  if (match.length >= 2 && !rawSubtype) {
    return { type: match[0], subtype: match.slice(1).join(' / ') };
  }
  return { type: rawType.trim(), subtype: rawSubtype?.trim() };
}

function collectDraft(text: string) {
  const draft: DraftExpense = {};
  const ignoredLines: string[] = [];
  const recognizedFields = new Set<string>();
  const parts = text
    .replace(/\r/g, '\n')
    .split(/[\n;]+/)
    .map(part => part.trim())
    .filter(Boolean);

  for (const part of parts) {
    const match = part.match(/^([^:=]+)\s*[:=]\s*(.+)$/);
    if (!match) {
      ignoredLines.push(part);
      continue;
    }

    const key = FIELD_ALIASES.get(fold(match[1]));
    if (!key) {
      ignoredLines.push(part);
      continue;
    }

    draft[key] = match[2].trim();
    recognizedFields.add(key);
  }

  return { draft, ignoredLines, recognizedFields: [...recognizedFields] };
}

export function parseTelegramExpenseText(text: string, now = new Date()): TelegramExpenseParseResult {
  const { draft, ignoredLines, recognizedFields } = collectDraft(text);
  const details: ApiErrorDetails = {};
  const baseToday = todayIso(now);

  if (recognizedFields.length === 0) {
    return {
      success: false,
      details: {
        _: [
          'Nenhum campo reconhecido. Use linhas como "nome: ...", "valor: ...", "categoria: ...", "subcategoria: ...", "pagamento: ...".'
        ]
      },
      ignoredLines,
      recognizedFields,
    };
  }

  const amount = parseAmount(draft.value);
  if (draft.value && amount === undefined) {
    details.value = ['Valor inválido. Use um número como 42,90.'];
  }

  const paymentType = parsePaymentType(draft.paymentType);
  if (draft.paymentType && !paymentType) {
    details.paymentType = ['Forma de pagamento inválida.'];
  }

  const parsedDate = parseDate(draft.date, baseToday);
  if (draft.date && !parsedDate) {
    details.date = ['Data inválida. Use YYYY-MM-DD, DD/MM/YYYY, hoje ou ontem.'];
  }

  const installments = parseInstallments(draft.installments);
  if (draft.installments && installments === undefined) {
    details.installments = ['Parcelas inválidas. Use um inteiro positivo.'];
  }

  const cardBrand = parseCardBrand(draft.cardBrand);
  if (draft.cardBrand && !cardBrand) {
    details.cardBrand = ['Cartão inválido. Use Master Santander, Visa Caixa ou Elo Caixa.'];
  }

  const { type, subtype } = splitTypeAndSubtype(draft.type, draft.subtype);

  if (paymentType && paymentType !== 'credit' && installments && installments > 1) {
    details.installments = ['Parcelas só são aceitas para pagamento no crédito.'];
  }

  if (paymentType && paymentType !== 'credit' && draft.cardBrand) {
    details.cardBrand = ['Cartão só deve ser informado para pagamento no crédito.'];
  }

  if (Object.keys(details).length > 0) {
    return { success: false, details, ignoredLines, recognizedFields };
  }

  const candidate: Record<string, unknown> = {
    name: draft.name,
    value: amount,
    type,
    subtype,
    date: parsedDate,
    paymentType,
  };

  if (paymentType === 'credit') {
    candidate.cardBrand = cardBrand ?? draft.cardBrand;
    if (installments !== undefined) candidate.installments = installments;
  }

  const parsed = createExpenseSchema.safeParse(candidate);
  if (!parsed.success) {
    return { success: false, details: toDetails(parsed.error), ignoredLines, recognizedFields };
  }

  return {
    success: true,
    expense: parsed.data,
    ignoredLines,
    recognizedFields,
  };
}
