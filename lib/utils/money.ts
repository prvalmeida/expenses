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

const PAYMENT_LABELS: Record<Expense['paymentType'], string> = {
  credit: 'Crédito',
  debit: 'Débito',
  pix: 'Pix',
  cash: 'Dinheiro',
  'food-voucher': 'Vale-alimentação',
  'meal-voucher': 'Vale-refeição',
  'fuel-voucher': 'Vale-combustível',
};

export function paymentLabel(paymentType: Expense['paymentType']): string {
  return PAYMENT_LABELS[paymentType] ?? paymentType;
}

const VOUCHERS: ReadonlySet<string> = new Set(['food-voucher', 'meal-voucher', 'fuel-voucher']);

/** Voucher spending is not the household's money, so month totals leave it out. */
export function isVoucher(paymentType: string | undefined): boolean {
  return !!paymentType && VOUCHERS.has(paymentType);
}
