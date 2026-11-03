// Pure display helpers for amounts and payment methods, shared by every screen so the
// "R$ 1.234,56" / "+R$ …" / "−R$ …" rules live in one place.

import type { Expense } from '@/types';

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

// Intl puts a no-break space between "R$" and the digits; keep it (it stops the symbol
// wrapping away from the amount) but normalise U+202F, which some ICU builds emit, to it.
function brl(abs: number): string {
  return BRL.format(abs).replace(/ /g, ' ');
}

/**
 * `R$ 1.234,56`. With `sign`, positives get `+` and negatives `−` (U+2212, the minus the
 * design system specifies — a hyphen reads as a dash in tabular figures). Without it a
 * negative still shows its minus; zero never carries a sign.
 */
export function formatBRL(value: number, opts: { sign?: boolean } = {}): string {
  const text = brl(Math.abs(value));
  if (value < 0) return `−${text}`;
  if (opts.sign && value > 0) return `+${text}`;
  return text;
}

/**
 * An amount in a foreign currency, pt-BR style (`US$ 10,00`, `€ 5,00`). Only for
 * display next to the BRL value a foreign purchase was converted to — every value
 * the app stores is in reais. An unknown code falls back to `USD 10,00`.
 */
export function formatForeign(value: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currencyCode })
      .format(Math.abs(value))
      .replace(/\u202f/g, '\u00a0');
  } catch {
    return `${currencyCode} ${Math.abs(value).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
}

const PAYMENT_LABELS: Record<Expense['paymentType'], string> = {
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'Pix',
  cash: 'Dinheiro',
  'food-voucher': 'Vale-alimentação',
  'meal-voucher': 'Vale-refeição',
  'fuel-voucher': 'Vale-combustível',
};

/** Options for every payment-method select, in the order the forms show them. */
export const PAYMENT_OPTIONS: { value: Expense['paymentType']; label: string }[] =
  (Object.keys(PAYMENT_LABELS) as Expense['paymentType'][]).map(value => ({ value, label: PAYMENT_LABELS[value] }));

export function paymentLabel(paymentType: Expense['paymentType']): string {
  return PAYMENT_LABELS[paymentType] ?? paymentType;
}

const VOUCHERS: ReadonlySet<string> = new Set(['food-voucher', 'meal-voucher', 'fuel-voucher']);

/** Voucher spending is not the household's money, so month totals leave it out. */
export function isVoucher(paymentType: string | undefined): boolean {
  return !!paymentType && VOUCHERS.has(paymentType);
}
