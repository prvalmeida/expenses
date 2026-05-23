import getOpenAI from '../openai';
import { CardBrand, ExpenseSubtypes, ParsedBillItem } from '@/types';
import connectToDatabase from '../mongodb';
import { BillMapping } from '../models/BillMapping';

const EXPENSE_TYPES = Object.keys(ExpenseSubtypes).join(', ');

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface PreprocessedTransaction {
  date: string;
  description: string;
  value: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  cardholder: string;
  subsection: string;
}

interface RawBillItem {
  date?: string;
  description?: string;
  value?: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  type?: string;
  subtype?: string;
}

interface RawBillResponse {
  items?: RawBillItem[];
}

interface ClassificationItem { type: string | null; subtype: string | null; }
interface ClassificationResponse { items: ClassificationItem[]; }

// ─── Shared helpers ───────────────────────────────────────────────────────────

// If txMonth is after dueMonth, the purchase is from the previous calendar year.
// e.g. dueMonth=4 (April 2026), txMonth=9 (September) → 2025
function inferYear(txMonth: number, dueMonth: number, dueYear: number): number {
  return txMonth > dueMonth ? dueYear - 1 : dueYear;
}

// "1.234,56" → 1234.56
function parseBRLAmount(raw: string): number {
  return parseFloat(raw.replace(/\./g, '').replace(',', '.'));
}

function extractDueDate(rawText: string): { dueMonth: number; dueYear: number } {
  const match = rawText.match(/\b\d{2}\/(\d{2})\/(\d{4})\b/);
  if (match) return { dueMonth: parseInt(match[1], 10), dueYear: parseInt(match[2], 10) };
  const now = new Date();
  return { dueMonth: now.getMonth() + 1, dueYear: now.getFullYear() };
}

function buildDate(dd: number, mm: number, dueMonth: number, dueYear: number): string {
  const year = inferYear(mm, dueMonth, dueYear);
  return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
}

// ─── Santander parser ─────────────────────────────────────────────────────────

// Parcelamentos — has installment field "DD/MM" between description and value
// Format C: leading digit  "3   03/02 PANVEL FARMACIAS   03/03   83,18"
const S_FMT_C = /^(\d+)\s+(\d{2})\/(\d{2})\s+(.+?)\s{2,}(\d{2}\/\d{2})\s{2,}(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
// Format D: no leading digit  "22/07 GRAN EDUCACAO   09/12   59,90"
const S_FMT_D = /^(\d{2})\/(\d{2})\s+(.+?)\s{2,}(\d{2}\/\d{2})\s{2,}(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

// Despesas — value immediately after description (no installment field)
// Format A: leading digit  "3   22/03 PASTEL DA BANCA 71 LTD   29,00"
const S_FMT_A = /^(\d+)\s+(\d{2})\/(\d{2})\s+(.+?)\s{2,}(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;
// Format B: no leading digit  "08/04 SCP COMPLETO- ABR/26   23,45"
const S_FMT_B = /^(\d{2})\/(\d{2})\s+(.+?)\s{2,}(\d{1,3}(?:\.\d{3})*,\d{2})\s*$/;

// Section markers — state machine uses these to track context
const S_CARDHOLDER   = /^(@?\s*[A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]+)\s*-\s*\d{4}\s+X{4}\s+X{4}\s+\d{4}\s*$/;
const S_PARCELAMENTOS = /^Parcelamentos\s*$/;
const S_DESPESAS      = /^Despesas\s*$/;
const S_PAGAMENTO     = /^Pagamento e Demais Créditos\s*$/;

// Noise patterns — strip before attempting to parse
const S_PAGE_MARKER  = /^\d+\/\d+\s*$/;                    // "3/4"
const S_DET_HEADER   = /^Detalhamento da Fatura\s*$/;       // repeated each page
const S_COL_HEADER   = /^Compra\s+Data\s+Descrição\s+Parcela\s+R\$/;
const S_VALOR_TOTAL  = /^VALOR TOTAL\b/;
const S_AUTH_CODE    = /^[A-Za-z0-9+\/;:]{15,}\s*$/;       // base64-like auth codes
const S_NEGATIVE     = /-[\d.,]+\s*$/;                      // credit/refund lines
const S_RESUMO       = /^Resumo da Fatura\s*$/;             // end of transaction data

function parseSantanderLine(
  line: string,
  subsection: 'Parcelamentos' | 'Despesas',
  cardholder: string,
  dueMonth: number,
  dueYear: number,
): PreprocessedTransaction | null {
  if (subsection === 'Parcelamentos') {
    let m = line.match(S_FMT_C);
    if (m) {
      const [cur, tot] = m[5].split('/').map(Number);
      return { date: buildDate(+m[2], +m[3], dueMonth, dueYear), description: m[4].trim(), value: parseBRLAmount(m[6]), installmentCurrent: cur, installmentTotal: tot, cardholder, subsection };
    }
    m = line.match(S_FMT_D);
    if (m) {
      const [cur, tot] = m[4].split('/').map(Number);
      return { date: buildDate(+m[1], +m[2], dueMonth, dueYear), description: m[3].trim(), value: parseBRLAmount(m[5]), installmentCurrent: cur, installmentTotal: tot, cardholder, subsection };
    }
  }

  if (subsection === 'Despesas') {
    let m = line.match(S_FMT_A);
    if (m) return { date: buildDate(+m[2], +m[3], dueMonth, dueYear), description: m[4].trim(), value: parseBRLAmount(m[5]), cardholder, subsection };
    m = line.match(S_FMT_B);
    if (m) return { date: buildDate(+m[1], +m[2], dueMonth, dueYear), description: m[3].trim(), value: parseBRLAmount(m[4]), cardholder, subsection };
  }

  return null;
}

function preprocessSantanderText(rawText: string): PreprocessedTransaction[] {
  const { dueMonth, dueYear } = extractDueDate(rawText);
  const results: PreprocessedTransaction[] = [];

  let inTransactionZone = false;
  let currentCardholder: string | null = null;
  let currentSubsection: 'Parcelamentos' | 'Despesas' | 'Pagamento' | null = null;

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (S_RESUMO.test(line)) break;
    if (S_DET_HEADER.test(line)) { inTransactionZone = true; continue; }
    if (!inTransactionZone) continue;
    if (S_PAGE_MARKER.test(line)) continue;
    if (S_COL_HEADER.test(line)) continue;
    if (S_VALOR_TOTAL.test(line)) continue;
    if (S_AUTH_CODE.test(line)) continue;

    const cardholderMatch = line.match(S_CARDHOLDER);
    if (cardholderMatch) {
      currentCardholder = cardholderMatch[1].trim();
      currentSubsection = null;
      continue;
    }

    if (S_PARCELAMENTOS.test(line)) { currentSubsection = 'Parcelamentos'; continue; }
    if (S_DESPESAS.test(line))      { currentSubsection = 'Despesas';      continue; }
    if (S_PAGAMENTO.test(line))     { currentSubsection = 'Pagamento';     continue; }

    if (!currentCardholder || !currentSubsection || currentSubsection === 'Pagamento') continue;
    if (S_NEGATIVE.test(line)) continue;

    const tx = parseSantanderLine(line, currentSubsection, currentCardholder, dueMonth, dueYear);
    if (tx) results.push(tx);
  }

  return results;
}

// ─── Caixa parser ─────────────────────────────────────────────────────────────

const C_CARDHOLDER     = /^([A-ZÁÀÂÃÉÊÍÓÔÕÚÇ][A-ZÁÀÂÃÉÊÍÓÔÕÚÇ\s]+)\s*\(Cartão\s+(\d{4})\)\s*$/;
const C_COMPRAS_HDR    = /^COMPRAS\s+\(Cartão\s+\d{4}\)\s*$/;
const C_PARCELADAS_HDR = /^COMPRAS PARCELADAS\s+\(Cartão\s+\d{4}\)\s*$/;
const C_ANUIDADE_SEC   = /^ANUIDADE\s*$/;
const C_ANUIDADE_LINE  = /^ANUIDADE\s{2,}([\d,]+)([DC])\s*$/;
const C_SUBTOTAL       = /^(Total|TOTAL)\b/;
const C_COL_HEADER     = /^(Data|Quantidade)\s+(Descrição|Parcela|Data)\s+/;
const C_END_MARKER     = /^Central de Atendimento Cartões Caixa\s*$/;
const C_CREDITO_HDR    = /^Crédito\/Débito R\$\s*$/;

// Installment field in COMPRAS PARCELADAS: "05 DE 10"
const C_INSTALL_FIELD  = /^(\d{2}) DE (\d{2})$/i;
// Value + D/C marker at end of field
const C_VALUE_DC       = /^(\d{1,3}(?:\.\d{3})*,\d{2})([DC])$/;

function parseCaixaLine(
  parts: string[],
  subsection: 'COMPRAS' | 'COMPRAS_PARCELADAS',
  cardholder: string,
  dueMonth: number,
  dueYear: number,
): PreprocessedTransaction | null {
  if (parts.length < 4) return null;

  const dateMatch = parts[0].match(/^(\d{2})\/(\d{2})$/);
  if (!dateMatch) return null;

  const lastPart = parts[parts.length - 1];
  const valueMatch = lastPart.match(C_VALUE_DC);
  if (!valueMatch) return null;
  if (valueMatch[2] === 'C') return null; // credit line — exclude

  const dd = parseInt(dateMatch[1], 10);
  const mm = parseInt(dateMatch[2], 10);
  const value = parseBRLAmount(valueMatch[1]);
  const date = buildDate(dd, mm, dueMonth, dueYear);

  if (subsection === 'COMPRAS_PARCELADAS') {
    // Expect: [date, description, "NN DE NN", city, value+D/C]
    if (parts.length >= 5) {
      const installMatch = parts[2].match(C_INSTALL_FIELD);
      if (installMatch) {
        return { date, description: parts[1].trim(), value, installmentCurrent: parseInt(installMatch[1], 10), installmentTotal: parseInt(installMatch[2], 10), cardholder, subsection };
      }
    }
    // Fallback: include without installment info
    return { date, description: parts[1].trim(), value, cardholder, subsection };
  }

  // COMPRAS — [date, description, city, value+D/C]
  return { date, description: parts[1].trim(), value, cardholder, subsection };
}

function preprocessCaixaText(rawText: string): PreprocessedTransaction[] {
  const { dueMonth, dueYear } = extractDueDate(rawText);
  const results: PreprocessedTransaction[] = [];

  let currentCardholder: string | null = null;
  let currentSubsection: 'COMPRAS' | 'COMPRAS_PARCELADAS' | 'ANUIDADE' | null = null;

  for (const rawLine of rawText.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    if (C_END_MARKER.test(line) && currentCardholder !== null) break;

    if (C_PARCELADAS_HDR.test(line)) { currentSubsection = 'COMPRAS_PARCELADAS'; continue; }
    if (C_COMPRAS_HDR.test(line))    { currentSubsection = 'COMPRAS';            continue; }

    const cardholderMatch = line.match(C_CARDHOLDER);
    if (cardholderMatch) {
      currentCardholder = cardholderMatch[1].trim();
      currentSubsection = null;
      continue;
    }

    // Skip Demonstrativo and pre-cardholder content
    if (currentCardholder === null) continue;

    if (C_ANUIDADE_SEC.test(line))   { currentSubsection = 'ANUIDADE';           continue; }
    if (C_CREDITO_HDR.test(line))    continue;
    if (C_SUBTOTAL.test(line))       continue;
    if (C_COL_HEADER.test(line))     continue;

    if (currentSubsection === 'ANUIDADE') {
      const m = line.match(C_ANUIDADE_LINE);
      if (m && m[2] === 'D') {
        const value = parseBRLAmount(m[1]);
        if (value > 0) {
          const dueDate = `${dueYear}-${String(dueMonth).padStart(2, '0')}-01`;
          results.push({ date: dueDate, description: 'ANUIDADE', value, cardholder: currentCardholder, subsection: 'ANUIDADE' });
        }
      }
      continue;
    }

    if (!currentSubsection || (currentSubsection !== 'COMPRAS' && currentSubsection !== 'COMPRAS_PARCELADAS')) continue;

    const parts = line.split(/\s{2,}/).map(s => s.trim()).filter(s => s.length > 0);
    const tx = parseCaixaLine(parts, currentSubsection, currentCardholder, dueMonth, dueYear);
    if (tx) results.push(tx);
  }

  return results;
}

// ─── GPT classification (bank-agnostic) ──────────────────────────────────────

async function classifyTransactions(transactions: PreprocessedTransaction[]): Promise<ParsedBillItem[]> {
  if (transactions.length === 0) return [];

  const payload = transactions.map(t => ({ description: t.description, value: t.value }));

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-5-nano',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Você é um assistente que classifica transações de cartão de crédito brasileiro.
Você receberá um array JSON de objetos { description, value }.
Retorne APENAS um JSON com a estrutura:
{
  "items": [
    { "type": "categoria ou null", "subtype": "subcategoria ou null" }
  ]
}

IMPORTANTE:
- O array "items" deve ter EXATAMENTE o mesmo número de elementos que o array de entrada, na mesma ordem.
- Para "type", use EXATAMENTE uma das categorias: ${EXPENSE_TYPES}. Se não conseguir classificar, use null.
- Para "subtype", use uma subcategoria compatível com o "type" escolhido. Se não conseguir, use null.
- Não extraia nem omita transações. Apenas classifique.`,
      },
      { role: 'user', content: JSON.stringify(payload) },
    ],
  });

  const raw: ClassificationResponse = JSON.parse(
    completion.choices[0].message.content ?? '{"items":[]}'
  );

  const classifications = raw.items ?? [];
  const validTypes = new Set(Object.keys(ExpenseSubtypes));

  return transactions.map((tx, i) => {
    const cls = classifications[i] ?? { type: null, subtype: null };
    const resolvedType =
      cls.type && validTypes.has(cls.type)
        ? (cls.type as keyof typeof ExpenseSubtypes)
        : null;
    const resolvedSubtype =
      resolvedType && cls.subtype
        ? (ExpenseSubtypes[resolvedType] as readonly string[]).includes(cls.subtype)
          ? cls.subtype
          : null
        : null;

    return {
      date: tx.date,
      description: tx.description,
      value: tx.value,
      ...(tx.installmentCurrent !== undefined && { installmentCurrent: tx.installmentCurrent }),
      ...(tx.installmentTotal !== undefined && { installmentTotal: tx.installmentTotal }),
      type: resolvedType,
      subtype: resolvedSubtype,
      recognized: false,
    };
  });
}

// ─── Legacy path (GPT extraction for unknown banks) ───────────────────────────

async function parseBillTextLegacy(rawText: string): Promise<ParsedBillItem[]> {
  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-5-nano',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Você é um assistente que extrai transações de faturas de cartão de crédito brasileiras.
Retorne APENAS um JSON com a estrutura:
{
  "items": [
    {
      "date": "YYYY-MM-DD",
      "description": "nome do estabelecimento ou descrição",
      "value": 0.00,
      "installmentCurrent": 1,
      "installmentTotal": 3,
      "type": "categoria ou null",
      "subtype": "subcategoria ou null"
    }
  ]
}

Parte A — Processo obrigatório:
- Varre o texto de cima a baixo, linha a linha, sem pular seções nem parar cedo.
- Processa cada seção de cartão de forma independente, do início ao fim de cada seção.
- Antes de montar o JSON final, verifica se alguma linha de débito foi deixada para trás.
- O texto já está estruturado com quebras de linha: trate cada linha como uma unidade de dados independente.
- REGRA ABSOLUTA: todo débito encontrado DEVE gerar uma entrada no JSON. Se não for possível determinar a categoria, use \`type: null\` e \`subtype: null\`. Nunca omita um débito por falta de categoria.

Parte B — O que IGNORAR (lista de exclusão explícita):
Ignore SOMENTE as seguintes linhas:
- Pagamentos recebidos: linhas com "PAGAMENTO", "CRÉDITO EM CONTA"
- Estornos e créditos: linhas com "CRÉDITO", "ESTORNO", "AJUSTE CRED"
- Totais e subtotais de seção (ex: "TOTAL DA FATURA R$ X", "SUBTOTAL")
- Saldo anterior, limite disponível, informações de rodapé
Tudo o mais que represente um débito deve ser incluído.

Parte C — Contexto por banco (dicas de layout, não filtros):
- Caixa: cada seção de cartão tem cabeçalho com os últimos dígitos (ex: "CARTÃO VISA CAIXA •••• 6806"). Dentro de cada seção existem subseções "COMPRAS" (avulsas) e "COMPRAS PARCELADAS" — AMBAS devem ser extraídas de CADA seção de cartão. Parcelas: formato "DD DE NN" na descrição.
- Santander: a fatura pode conter múltiplas seções de cartão (titular, adicionais, virtuais). Processe CADA seção de cartão de forma independente, do início ao fim. Dentro de cada seção: compras no formato "[DD/MM] [ESTABELECIMENTO] [X/Y?] [R$ valor]"; compras parceladas ficam em subseção "Parcelamentos" — incluir TODOS os itens; taxas e encargos ficam em subseção "DESPESAS" ou "ENCARGOS" — incluir TODOS os itens.
- O campo "date" deve ser "YYYY-MM-DD". Infira o ano com base na data de vencimento mencionada na fatura.
- Se a compra tiver parcelas, preencha "installmentCurrent" e "installmentTotal" (ambos inteiros). Se não houver, omita esses campos.
- Para "type", use EXATAMENTE uma das categorias: ${EXPENSE_TYPES}. Se não conseguir classificar com certeza, use null — o item AINDA ASSIM deve aparecer no JSON.
- Para "subtype", use uma subcategoria compatível com o "type" escolhido. Se não conseguir classificar, use null.
- Valores devem ser números positivos (ponto como separador decimal).`,
      },
      { role: 'user', content: rawText },
    ],
  });

  const raw: RawBillResponse = JSON.parse(completion.choices[0].message.content ?? '{}');

  if (!raw.items?.length) return [];

  const validTypes = new Set(Object.keys(ExpenseSubtypes));

  return raw.items
    .filter(item => item.description && item.value !== undefined)
    .map(item => {
      const resolvedType =
        item.type && validTypes.has(item.type)
          ? (item.type as keyof typeof ExpenseSubtypes)
          : null;
      const resolvedSubtype =
        resolvedType && item.subtype
          ? (ExpenseSubtypes[resolvedType] as readonly string[]).includes(item.subtype)
            ? item.subtype
            : null
          : null;

      return {
        date: item.date ?? '',
        description: item.description!,
        value: item.value!,
        ...(item.installmentCurrent !== undefined && { installmentCurrent: item.installmentCurrent }),
        ...(item.installmentTotal !== undefined && { installmentTotal: item.installmentTotal }),
        type: resolvedType,
        subtype: resolvedSubtype,
        recognized: false,
      };
    });
}

// ─── Closing date / due date extractors ──────────────────────────────────────

export function extractFullDueDate(rawText: string): string | null {
  const match = rawText.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (!match) return null;
  return `${match[3]}-${match[2]}-${match[1]}`;
}

export function extractClosingDate(rawText: string, cardBrand: CardBrand): string | null {
  if (cardBrand === CardBrand.MasterSantander) {
    const match = rawText.match(/realizados até (\d{2})\/(\d{2})/);
    if (!match) return null;
    const dd = parseInt(match[1], 10);
    const mm = parseInt(match[2], 10);
    const { dueMonth, dueYear } = extractDueDate(rawText);
    const year = inferYear(mm, dueMonth, dueYear);
    return `${year}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
  }

  if (cardBrand === CardBrand.Visa || cardBrand === CardBrand.EloCaixa) {
    const match = rawText.match(/aprovadas até dia (\d{2})\/(\d{2})\/(\d{4})/);
    if (!match) return null;
    return `${match[3]}-${match[2]}-${match[1]}`;
  }

  return null;
}

// ─── BillMapping cross-reference ─────────────────────────────────────────────

async function crossReferenceBillMappings(items: ParsedBillItem[]): Promise<ParsedBillItem[]> {
  if (items.length === 0) return items;
  await connectToDatabase();
  const normalizedDescriptions = items.map(i => i.description.toLowerCase().trim());
  const mappings = await BillMapping.find({ description: { $in: normalizedDescriptions } });
  const mappingMap = new Map(mappings.map(m => [m.description, { type: m.type, subtype: m.subtype as string | null }]));
  return items.map(item => {
    const saved = mappingMap.get(item.description.toLowerCase().trim());
    if (!saved) return item;
    return { ...item, type: saved.type as keyof typeof ExpenseSubtypes, subtype: saved.subtype, recognized: true };
  });
}

// ─── Public API ───────────────────────────────────────────────────────────────

export async function parseBillText(rawText: string, cardBrand?: CardBrand): Promise<ParsedBillItem[]> {
  let items: ParsedBillItem[];

  if (cardBrand === CardBrand.MasterSantander) {
    console.log('[parseBillText] Santander — extracting deterministically');
    const transactions = preprocessSantanderText(rawText);
    console.log(`[parseBillText] Santander — ${transactions.length} transactions found from ${new Set(transactions.map(t => t.cardholder)).size} cardholders`);
    items = await classifyTransactions(transactions);
  } else if (cardBrand === CardBrand.Visa || cardBrand === CardBrand.EloCaixa) {
    console.log('[parseBillText] Caixa — extracting deterministically');
    const transactions = preprocessCaixaText(rawText);
    console.log(`[parseBillText] Caixa — ${transactions.length} transactions found from ${new Set(transactions.map(t => t.cardholder)).size} cardholders`);
    items = await classifyTransactions(transactions);
  } else {
    items = await parseBillTextLegacy(rawText);
  }

  return crossReferenceBillMappings(items);
}
