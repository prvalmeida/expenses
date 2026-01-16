export enum CardBrand {
    MasterSantander = 'Master Santander',
    Visa = 'Visa Caixa',
    EloCaixa = 'Elo Caixa'
} 

export const ExpenseSubtypes = {
  'farmácia': ['Remédio', 'Fralda', 'Leite Dudu', 'Lenços Umedecidos', 'Outros'],
  'saúde': ['Médico', 'Nina', 'Seguro de Vida'],
  'comida': ['Restaurante', 'Cafeteria', 'Lanche', 'Pizza', 'Ração Nina', 'Assinaturas', 'Padaria', 'Confetaria', 'Chocolate'],
  'estética': ['Cabelereiro', 'Unha', 'Costureira'],
  'esportes': ['Academia', 'Natação'],
  'transporte': ['Gasolina', 'Uber', 'Revisão', 'Estacionamento', 'Lavagem', 'Aluguel Carro'],
  'casa': ['Luz', 'Água', 'Internet/TV', 'Condomínio', 'Financiamento casa', 'Faxina', 'Gás', 'Manutenção', 'Móveis', 'Jardim'],
  'estudo': ['Curso', 'Colégio', 'Livro'],
  'lazer': ['Streaming', 'Bar', 'Assinaturas', 'Outros'],
  'taxas': ['Anuidade cartão', 'Seguro'],
  'compras': ['Roupas', 'Outros', 'Brinquedos', 'Cosméticos', 'Jóias', 'Café'],
  'viagens': ['Passagens', 'Fidelidade CIA Aérea'],
  'assinaturas': ['Google Drive', 'Icloud'],
  'supermercado': [
    'Limpeza',
    'Higiene',
    'Pão',
    'Suco',
    'Iogurte',
    'Café',
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
    'Outros'
  ],
  'feira': [
    'Fruta',
    'Verdura/Legume',
    'Castanha',
    'Pão',
    'Outros'
  ]
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
  paymentType: 'cash' | 'debit' | 'pix'; 
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
  paymentType: 'credit' | 'cash' | 'debit' | 'pix' | '';
  cardBrand: CardBrand | undefined;
  date: string;
  installments: number | undefined;
}