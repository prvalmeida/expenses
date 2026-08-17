// Wire-only request types are inferred from the Zod schemas that validate them
// (see the `Confirmed*`/`NewBillMapping` re-exports at the bottom): they exist
// purely to describe request bodies, so a schema that drops a field must break
// every reader. Types describing DB documents stay hand-written here and are
// `satisfies`-checked from the schema side instead — the UI constructs them
// directly and they must not be reshaped by an API concern.
//
// `import type` is load-bearing: lib/api/schemas/common.ts imports CardBrand
// from this module at runtime, so a value import here would close the cycle.
import type { ConfirmedBillItemBody, NewBillMappingBody } from '../lib/api/schemas/bill';
import type { ConfirmedReceiptItemBody } from '../lib/api/schemas/receipt';

export enum CardBrand {
    MasterSantander = 'Master Santander',
    Visa = 'Visa Caixa',
    EloCaixa = 'Elo Caixa'
} 

export const ExpenseSubtypes = {
  'farmácia': ['Remédio', 'Fralda', 'Leite Dudu', 'Lenços Umedecidos', 'Outros'],
  'saúde': ['Médico', 'Nina', 'Seguro de Vida', 'Suplementos', 'Vacina'],
  'comida': ['Restaurante', 'Cafeteria', 'Lanche', 'Pizza', 'Ração Nina', 'Assinaturas', 'Padaria', 'Confetaria', 'Chocolate', 'Peixaria', 'Outros'],
  'estética': ['Cabelereiro', 'Unha', 'Costureira', 'Outros'],
  'esportes': ['Academia', 'Natação', 'Corrida'],
  'transporte': ['Gasolina', 'Uber', 'Revisão', 'Estacionamento', 'Lavagem', 'Aluguel Carro', 'Seguro', 'IPVA', 'Licenciamento', 'Pedágio', 'Outros'],
  'casa': ['Luz', 'Água', 'Internet/TV', 'Condomínio', 'Financiamento casa', 'Faxina', 'Gás', 'Manutenção', 'Móveis', 'Jardim', 'IPTU'],
  'estudo': ['Curso', 'Colégio', 'Livro', 'Outros', 'IA'],
  'lazer': ['Streaming', 'Bar', 'Assinaturas', 'Outros', 'Cinema'],
  'taxas': ['Anuidade cartão', 'Seguro Cartão', 'Proteção conta', 'Conta bancária'],
  'compras': ['Roupas', 'Outros', 'Brinquedos', 'Cosméticos', 'Jóias', 'Café', 'Eletrônicos', 'Louça', 'Presente'],
  'viagens': ['Passagens', 'Fidelidade CIA Aérea', 'Hotel'],
  'assinaturas': ['Google Drive', 'Icloud', 'Microsoft', 'GaúchaZH'],
  'supermercado': [
    'Limpeza',
    'Higiene',
    'Pão',
    'Suco',
    'Iogurte',
    'Café/Chá',
    'Frango',
    'Carne',
    'Cerveja',
    'Água',
    'Frios/Embutidos',
    'Ovos',
    'Leite',
    'Requeijão/Manteiga/Margarina',
    'Atum',
    'Comida',
    'Fruta',
    'Verdura/Legume',
    'Outros',
    'Refrigerante',
    'Chocolate',
    'Salgadinho',
    'Massa',
    'Lanche',
    'Água de coco',
    'Azeite/Óleo',
    'Barrinha',
    'Biscoito',
    'Guardanapo',
    'Vinho',
    'Biscoito de arroz',
    'Arroz',
    'Maionese/Mostarda/Ketchup',
    'Creme de Leite',
    'Conservas',
    'Molho de Tomate',
    'Farinha',
    'Batata Palha',
    'Leite Condensado',
    'Fralda',
    'Nina',
    'Peixe',
    'Chiclete/Bala',
    'Feijão',
    'Mariola',
    'Batata Frita',
    'Fermento',
    'Açúcar',
    'Papel alumínio/Papel filme',
    'Carvão',
    'Geleia'
  ],
  'feira': [
    'Fruta',
    'Verdura/Legume',
    'Castanha',
    'Pão',
    'Outros'
  ],
  'trabalho': ['assinaturas', 'serviços']
} as const;

interface BaseExpense {
  _id?: string;
  name: string;
  value: number;
  type: string;
  subtype?: string;
  date: string;
  effectiveDate: string;
  transactionId?: string;
}

interface CreditExpense extends BaseExpense {
  paymentType: 'credit';
  cardBrand: CardBrand;
  installment: number;
  totalInstallments: number;
}

interface OtherExpense extends BaseExpense {
  paymentType: 'cash' | 'debit' | 'pix' | 'food-voucher' | 'meal-voucher' | 'fuel-voucher'; 
  cardBrand?: never;
  installment?: never;
  totalInstallments?: never;
}

export type Expense = CreditExpense | OtherExpense;

// The eight fields an edit may touch. Derived from BaseExpense so renaming a
// document field breaks `updateExpenseSchema`, which is `satisfies`-checked
// against this type.
export type EditableExpenseFields = Pick<
  BaseExpense,
  'name' | 'value' | 'type' | 'subtype' | 'date'
> & {
  paymentType: Expense['paymentType'];
  cardBrand?: CardBrand;
  effectiveDate?: string;
};

export type ExpenseForm = {
  name: string;
  value: number | '';
  type: string;
  subtype?: string;
  paymentType: 'credit' | 'cash' | 'debit' | 'pix' | 'food-voucher' | 'meal-voucher' |'fuel-voucher' | '';
  cardBrand: CardBrand | undefined;
  date: string;
  installments: number | undefined;
}

export const IncomeTypes = ['salary', 'bonus', 'other'] as const;

export type IncomeType = string;

export interface Income {
  _id?: string;
  name: string;
  value: number;
  type: string;
  date: string;
}

export type IncomeForm = {
  name: string;
  value: number | '';
  type: string;
  date: string;
}

export type ParsedReceiptItem = {
  description: string;
  value: number;
  unitPrice?: number;
  type: string | null;
  subtype: string | null;
  recognized: boolean;
  fromMapping?: boolean;
  qty?: number;
  unit?: string;
};

export type ParsedBillItem = {
  date: string;
  description: string;
  value: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  type: string | null;
  subtype: string | null;
  recognized: boolean;
  isPossibleDuplicate?: boolean;
};

// Request bodies — inferred, never hand-written. ParsedBillItem/ParsedReceiptItem
// above stay hand-written: they are *response* shapes read by ImportBill.tsx and
// ImportReceipt.tsx, not payloads any schema validates.
export type ConfirmedBillItem = ConfirmedBillItemBody;
export type NewBillMapping = NewBillMappingBody;
export type ConfirmedReceiptItem = ConfirmedReceiptItemBody;
