import { z } from 'zod';
import { brlAmount, isoDate, objectId, paginationQuery } from './common';

export const createIncomeSchema = z.object({
  name: z.string().trim().min(1, 'Nome é obrigatório'),
  value: brlAmount,
  type: z.string().trim().min(1, 'Tipo é obrigatório'),
  date: isoDate,
});

export const updateIncomeSchema = createIncomeSchema;

export const listIncomesQuerySchema = paginationQuery.extend({
  from: isoDate.optional(),
  to: isoDate.optional(),
  type: z.string().trim().min(1).optional(),
});

export const incomeIdSchema = z.object({ id: objectId });

export type CreateIncomeBody = z.infer<typeof createIncomeSchema>;
export type ListIncomesQuery = z.infer<typeof listIncomesQuerySchema>;
