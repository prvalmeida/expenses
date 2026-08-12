import { z } from 'zod';
import { brlAmount, cardBrand, isoDate } from './common';

// `type: null` is a legitimate value, not a missing field: it is how the review
// table reports a row the user left unclassified, and /api/bills/import counts
// those as skippedInvalid rather than rejecting the batch.
export const confirmedBillItemSchema = z.object({
  date: isoDate,
  description: z.string().trim().min(1),
  value: brlAmount,
  installmentCurrent: z.number().int().positive().optional(),
  installmentTotal: z.number().int().positive().optional(),
  type: z.string().trim().min(1).nullable(),
  subtype: z.string().trim().min(1).nullable(),
});

export const newBillMappingSchema = z.object({
  description: z.string().trim().min(1),
  type: z.string().trim().min(1),
  subtype: z.string().trim().min(1).nullable(),
});

export const importBillSchema = z.object({
  items: z.array(confirmedBillItemSchema).min(1, 'items é obrigatório'),
  cardBrand,
  closingDate: isoDate.nullable().default(null),
  dueDate: isoDate.nullable().default(null),
  newMappings: z.array(newBillMappingSchema).optional(),
});

export const parseBillSchema = z.object({
  cardBrand,
  password: z.string().min(1).optional(),
});

export type ConfirmedBillItemBody = z.infer<typeof confirmedBillItemSchema>;
export type NewBillMappingBody = z.infer<typeof newBillMappingSchema>;
export type ImportBillBody = z.infer<typeof importBillSchema>;
