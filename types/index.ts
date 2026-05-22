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

// Helper to get the union of all possible subtypes
export type Subtype = (typeof ExpenseSubtypes)[keyof typeof ExpenseSubtypes][number];

interface BaseExpense {
  _id?: string;
  name: string;
  value: number;
  type: keyof typeof ExpenseSubtypes;
  subtype?: Subtype;
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

export type ExpenseForm = {
  name: string;
  value: number | '';
  type: keyof typeof ExpenseSubtypes | ''; 
  subtype?: string;
  paymentType: 'credit' | 'cash' | 'debit' | 'pix' | 'food-voucher' | 'meal-voucher' |'fuel-voucher' | '';
  cardBrand: CardBrand | undefined;
  date: string;
  installments: number | undefined;
}

export const IncomeTypes = ['salary', 'bonus', 'other'] as const;

export type IncomeType = typeof IncomeTypes[number];

export interface Income {
  _id?: string;
  name: string;
  value: number;
  type: IncomeType;
  date: string;
}

export type IncomeForm = {
  name: string;
  value: number | '';
  type: IncomeType | '';
  date: string;
}

export type ParsedReceiptItem = {
  description: string;
  value: number;
  unitPrice?: number;
  type: keyof typeof ExpenseSubtypes | null;
  subtype: string | null;
  recognized: boolean;
  qty?: number;
  unit?: string;
};

export type ConfirmedReceiptItem = {
  description: string;
  value: number;
  type: keyof typeof ExpenseSubtypes;
  subtype?: string;
  qty?: number;
  unit?: string;
};

export type ParsedBillItem = {
  date: string;
  description: string;
  value: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  type: keyof typeof ExpenseSubtypes | null;
  subtype: string | null;
};

export type ConfirmedBillItem = {
  date: string;
  description: string;
  value: number;
  installmentCurrent?: number;
  installmentTotal?: number;
  type: keyof typeof ExpenseSubtypes | null;
  subtype: string | null;
};