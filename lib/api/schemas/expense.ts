import { z } from 'zod';
import { brlAmount, cardBrand, isoDate, objectId, paginationQuery, paymentType } from './common';

const base = {
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  value: brlAmount,
  type: z.string().trim().min(1, 'Categoria é obrigatória'),
  subtype: z.string().trim().min(1).optional(),
  date: isoDate,
};

// `value` is the total of the purchase by default, matching what the form
// screen submits; a caller echoing a bill row back, where each row is already
// one installment's amount, sets valueIsTotal: false. The rule changes what the
// number means, so it is an explicit field rather than a service argument.
const valueIsTotal = z.boolean().default(true);

// The CreditExpense/OtherExpense split in types/index.ts is compile-time only
// today: POST /api/expenses does `new Expense(body)`, and Mongoose strict mode
// drops unknown keys but not known-yet-invalid combinations, so a pix expense
// carrying a cardBrand is accepted. The union is what enforces it at runtime.
export const createExpenseSchema = z.discriminatedUnion('paymentType', [
  z.object({
    ...base,
    paymentType: z.literal('credit'),
    cardBrand,
    installments: z.number().int().positive().max(72).default(1),
    valueIsTotal,
  }),
  z.object({
    ...base,
    paymentType: paymentType.exclude(['credit']),
    cardBrand: z.never().optional(),
    installment: z.never().optional(),
    totalInstallments: z.never().optional(),
  }),
]);

// The eight editable fields. transactionId/installment/totalInstallments are
// deliberately absent — an edit never reshapes an installment group.
export const updateExpenseSchema = z.object({
  name: base.name,
  value: base.value,
  type: base.type,
  subtype: base.subtype,
  paymentType,
  cardBrand: cardBrand.optional(),
  date: isoDate,
  effectiveDate: isoDate.optional(),
});

export const patchExpenseSchema = updateExpenseSchema.partial();

export const listExpensesQuerySchema = paginationQuery.extend({
  // Mirrors the Dashboard's "DATA DA COMPRA" / "FLUXO DE CAIXA" toggle.
  dateField: z.enum(['date', 'effectiveDate']).default('date'),
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.string().trim().min(1).optional(),
  subtype: z.string().trim().min(1).optional(),
  paymentType: paymentType.optional(),
  cardBrand: cardBrand.optional(),
  transactionId: z.string().trim().min(1).optional(),
});

export const expenseIdSchema = z.object({ id: objectId });

export type CreateExpenseBody = z.infer<typeof createExpenseSchema>;
export type UpdateExpenseBody = z.infer<typeof updateExpenseSchema>;
export type PatchExpenseBody = z.infer<typeof patchExpenseSchema>;
export type ListExpensesQuery = z.infer<typeof listExpensesQuerySchema>;
