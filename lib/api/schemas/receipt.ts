import { z } from 'zod';
import { brlAmount, cardBrand, isoDate, paymentType } from './common';

// The JSON variant of /v1/receipts/parse. The multipart variant carries the PDF
// itself and is validated by the route's file check, not here.
export const parseReceiptUrlSchema = z.object({
  url: z.url('URL inválida'),
});

export const confirmedReceiptItemSchema = z.object({
  description: z.string().trim().min(1),
  value: brlAmount,
  type: z.string().trim().min(1),
  subtype: z.string().trim().min(1).optional(),
  qty: z.number().positive().optional(),
  unit: z.string().trim().min(1).optional(),
});

export const importReceiptSchema = z.object({
  cnpj: z.string().trim().min(1, 'cnpj é obrigatório'),
  address: z.string().trim().min(1).optional(),
  date: isoDate,
  paymentType,
  cardBrand: cardBrand.optional(),
  items: z.array(confirmedReceiptItemSchema).min(1, 'items é obrigatório'),
  newMappings: z.array(confirmedReceiptItemSchema).optional(),
  storeDefaultType: z.string().trim().min(1).optional(),
  installments: z.number().int().positive().max(72).default(1),
});

export type ParseReceiptUrlBody = z.infer<typeof parseReceiptUrlSchema>;
export type ConfirmedReceiptItemBody = z.infer<typeof confirmedReceiptItemSchema>;
export type ImportReceiptBody = z.infer<typeof importReceiptSchema>;
