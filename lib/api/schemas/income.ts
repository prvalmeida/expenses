import { z } from 'zod';
import { Income } from '@/types';
import { brlAmount, isoDate, objectId, paginationQuery } from './common';

// `satisfies`-checked rather than inferred: Income describes a DB document the
// UI also constructs directly, so it stays hand-written in types/index.ts and
// the schema is asserted against it. Dropping or renaming a field here fails
// the build instead of drifting silently.
export const createIncomeSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  value: brlAmount,
  type: z.string().trim().min(1, 'Tipo é obrigatório'),
  date: isoDate,
}) satisfies z.ZodType<Omit<Income, '_id'>>;

export const updateIncomeSchema = createIncomeSchema;

export const listIncomesQuerySchema = paginationQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.string().trim().min(1).optional(),
});

export const incomeIdSchema = z.object({ id: objectId });

export type CreateIncomeBody = z.infer<typeof createIncomeSchema>;
export type ListIncomesQuery = z.infer<typeof listIncomesQuerySchema>;
