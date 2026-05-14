import connectToDatabase from '../mongodb';
import { Store } from '../models/Store';
import { ProductMapping } from '../models/ProductMapping';
import openai from '../openai';
import { ExpenseSubtypes, ParsedReceiptItem } from '@/types';

const SUPERMERCADO_SUBTYPES = [...ExpenseSubtypes['supermercado']].join(', ');

export function normalize(str: string): string {
  return str.toLowerCase().trim();
}

function nameFromAddress(address: string): string {
  return address.match(/^([^\d,]+)/)?.[1].trim() ?? address.split(',')[0].trim();
}

interface RawItem {
  description: string;
  totalValue?: number;
  unitPrice?: number;
  type?: string;
  subtype?: string;
  qty?: number;
  unit?: string;
}

interface RawReceipt {
  date?: string;
  cnpj?: string;
  storeName?: string;
  address?: string;
  paymentType?: string;
  total?: number;
  discounts?: number;
  amountDue?: number;
  items?: RawItem[];
}

export type ParseResponse = {
  store: { cnpj: string; name: string; address: string | null };
  date: string | null;
  paymentType: string | null;
  total?: number;
  discounts?: number;
  amountDue?: number;
  items: ParsedReceiptItem[];
};

export async function interpretAndCrossReference(rawText: string): Promise<ParseResponse> {
  const completion = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Você é um assistente que extrai dados estruturados de notas fiscais brasileiras.
Retorne APENAS um JSON com a estrutura:
{
  "date": "YYYY-MM-DD",
  "cnpj": "somente números, 14 dígitos",
  "storeName": "nome do estabelecimento",
  "address": "endereço completo do estabelecimento",
  "paymentType": "um dos valores listados abaixo",
  "total": 0.00,
  "discounts": 0.00,
  "amountDue": 0.00,
  "items": [{ "description": "descrição do produto", "unitPrice": 0.00, "totalValue": 0.00, "qty": 1.0, "unit": "UN" }]
}

Para os campos financeiros do cabeçalho:
- "total": valor do campo "Valor Total" ou "Total" da nota. Omita se não encontrar.
- "discounts": valor do campo "Descontos" da nota. Omita se não encontrar ou se for zero.
- "amountDue": valor do campo "Valor a Pagar" da nota. Omita se não encontrar.

Para cada item, extraia:
- "unitPrice": valor exato do campo "Vl. Unit." ou "Valor Unitário" da linha do item.
- "totalValue": valor exato do campo "Vl. Total" ou "Valor Total" da linha do item.
- "qty": a quantidade do campo "Qtde" convertida para número decimal (vírgula como separador decimal, ex: "1,500" → 1.5).
- "unit": o valor exato do campo "UN" da linha do item ("UN" para unidade, "KG" para quilograma). Omita esses campos se não encontrar.

Para o campo paymentType, identifique a forma de pagamento da nota (campo "FORMA DE PAGAMENTO") e mapeie para um destes valores exatos: Crédito→"credit", Débito→"debit", PIX→"pix", Dinheiro/Espécie→"cash", Vale Alimentação→"food-voucher", Vale Refeição→"meal-voucher", Vale Combustível→"fuel-voucher". Se não identificar, omita o campo.

Todos os itens são do tipo supermercado. Para cada item, tente classificar com uma das seguintes subcategorias: ${SUPERMERCADO_SUBTYPES}. Se conseguir, adicione "subtype" ao objeto do item. Se não conseguir classificar, omita "subtype".`,
      },
      { role: 'user', content: rawText },
    ],
  });

  const raw: RawReceipt = JSON.parse(completion.choices[0].message.content ?? '{}');

  if (!raw.cnpj || !raw.items?.length) {
    throw new Error('Não foi possível extrair dados válidos da nota fiscal');
  }

  await connectToDatabase();

  const address = raw.address ?? null;
  const storeName = raw.storeName ?? (address ? nameFromAddress(address) : raw.cnpj);

  await Store.updateOne(
    { cnpj: raw.cnpj, address },
    { $set: { name: storeName } },
    { upsert: true }
  );

  const mappings = await ProductMapping.find({ cnpj: raw.cnpj, address });
  const mappingMap = new Map(
    mappings.map(m => [m.description, { type: m.type, subtype: m.subtype as string | undefined }])
  );

  const supermercadoSubtypes: readonly string[] = ExpenseSubtypes['supermercado'];

  const items: ParsedReceiptItem[] = raw.items.map(item => {
    const key = normalize(item.description);
    const saved = mappingMap.get(key);

    const itemValue = item.totalValue ?? 0;
    const qtyUnit = { ...(item.qty !== undefined && { qty: item.qty }), ...(item.unit && { unit: item.unit }), ...(item.unitPrice !== undefined && { unitPrice: item.unitPrice }) };

    if (saved) {
      return {
        description: item.description,
        value: itemValue,
        type: 'supermercado' as keyof typeof ExpenseSubtypes,
        subtype: saved.subtype ?? null,
        recognized: true,
        ...qtyUnit,
      };
    }

    if (item.subtype && supermercadoSubtypes.includes(item.subtype)) {
      return {
        description: item.description,
        value: itemValue,
        type: 'supermercado' as keyof typeof ExpenseSubtypes,
        subtype: item.subtype,
        recognized: true,
        ...qtyUnit,
      };
    }

    return {
      description: item.description,
      value: itemValue,
      type: null,
      subtype: null,
      recognized: false,
      ...qtyUnit,
    };
  });

  return {
    store: { cnpj: raw.cnpj, name: storeName, address },
    date: raw.date ?? null,
    paymentType: raw.paymentType ?? null,
    ...(raw.total !== undefined && { total: raw.total }),
    ...(raw.discounts !== undefined && { discounts: raw.discounts }),
    ...(raw.amountDue !== undefined && { amountDue: raw.amountDue }),
    items,
  };
}
