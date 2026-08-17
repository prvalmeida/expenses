import { z } from 'zod';
import { CardBrand } from '@/types';

// Expense.date / effectiveDate are String in the Mongoose schema and the whole
// codebase compares them lexically (cycleUtils, the Dashboard filters). Parsing
// to a Date at the boundary would force a re-serialization on every write and
// invite a timezone shift, so ISO dates stay strings end to end.
export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data deve estar no formato YYYY-MM-DD');

// Rejects more than two decimal places rather than rounding: the installment
// split rounds to two places, so a 4-decimal input would make the sum of the
// installments silently differ from the submitted total.
export const brlAmount = z
  .number()
  .positive('Valor deve ser positivo')
  .refine(n => Math.round(n * 100) / 100 === n, 'Valor deve ter no máximo 2 casas decimais');

export const cardBrand = z.enum(CardBrand);

export const PAYMENT_TYPES = [
  'credit',
  'cash',
  'debit',
  'pix',
  'food-voucher',
  'meal-voucher',
  'fuel-voucher',
] as const;

export const paymentType = z.enum(PAYMENT_TYPES);

export const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Identificador inválido');

// Every installment count on the wire shares this ceiling. It is not cosmetic:
// buildExpenseDocuments awaits a CardCycle lookup and an insert per installment,
// so an unbounded count is an event-loop stall and a flooded collection from a
// single request — including one produced by a mis-guessed Caixa `NN DE NN`.
export const MAX_INSTALLMENTS = 72;

export const installmentCount = z.number().int().positive().max(MAX_INSTALLMENTS);

export const DEFAULT_PAGE_LIMIT = 100;
export const MAX_PAGE_LIMIT = 500;

// An unbounded limit would re-create the problem this replaces — GET
// /api/expenses ships the entire financial history on every call.
export const paginationQuery = z.object({
  limit: z.coerce.number().int().positive().max(MAX_PAGE_LIMIT).default(DEFAULT_PAGE_LIMIT),
  cursor: objectId.optional(),
});
