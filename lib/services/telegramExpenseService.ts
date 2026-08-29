import { ZodError } from 'zod';
import { createExpenseSchema, CreateExpenseBody } from '@/lib/api/schemas/expense';
import { ApiErrorDetails } from '@/lib/api/respond';
import { getExpenseCategories } from '@/lib/utils/categoryUtils';
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

const PAYMENT_TYPE_ALIASES: Record<string, CreateExpenseBody['paymentType']> = {
  credit: 'credit',
  credito: 'credit',
  'crédito': 'credit',
  cash: 'cash',
  dinheiro: 'cash',
  especie: 'cash',
  'espécie': 'cash',
  debit: 'debit',
  debito: 'debit',
  'débito': 'debit',
  pix: 'pix',
  'vale alimentacao': 'food-voucher',
  'vale alimentação': 'food-voucher',
  'alimentacao': 'food-voucher',
  'alimentação': 'food-voucher',
  'vale refeicao': 'meal-voucher',
  'vale refeição': 'meal-voucher',
  refeicao: 'meal-voucher',
  refeição: 'meal-voucher',
  'vale combustivel': 'fuel-voucher',
  'vale combustível': 'fuel-voucher',
  combustivel: 'fuel-voucher',
  combustível: 'fuel-voucher',
};

const CARD_BRAND_ALIASES: Record<string, CreateExpenseBody['cardBrand']> = {
  'master santander': CardBrand.MasterSantander,
  master: CardBrand.MasterSantander,
  mastercard: CardBrand.MasterSantander,
  'visa caixa': CardBrand.Visa,
  visa: CardBrand.Visa,
  'elo caixa': CardBrand.EloCaixa,
  elo: CardBrand.EloCaixa,
};

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

function parseAmount(raw?: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/^r\$\s*/i, '').replace(/\./g, '').replace(',', '.').trim();
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : undefined;
}

function parseInstallments(raw?: string): number | undefined {
  if (!raw) return undefined;
  const match = raw.match(/\d+/);
  if (!match) return undefined;
  const value = Number(match[0]);
  return Number.isInteger(value) ? value : undefined;
}

function parseDate(raw: string | undefined, baseToday: string): string | undefined {
  if (!raw) return baseToday;
  const normalized = fold(raw);
  if (normalized === 'hoje') return baseToday;
  if (normalized === 'ontem') return offsetIso(baseToday, -1);
  if (normalized === 'amanha' || normalized === 'amanhã') return offsetIso(baseToday, 1);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();

  const br = raw.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return undefined;
}

function parsePaymentType(raw?: string): CreateExpenseBody['paymentType'] | undefined {
  if (!raw) return undefined;
  return PAYMENT_TYPE_ALIASES[fold(raw)];
}

function parseCardBrand(raw?: string): CreateExpenseBody['cardBrand'] | undefined {
  if (!raw) return undefined;
  return CARD_BRAND_ALIASES[fold(raw)];
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

export async function resolveExpenseCategoryCasing(type: string, subtype: string) {
  const categories = await getExpenseCategories();
  const category = categories.find(item => fold(item.name) === fold(type));
  if (!category) return null;

  const matchedSubtype = category.subtypes.find(item => fold(item) === fold(subtype));
  if (!matchedSubtype) return null;

  return { type: category.name, subtype: matchedSubtype };
}
