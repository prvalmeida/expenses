import { z } from 'zod';
import { cardBrand } from './common';

// Query schemas for the two read-only support endpoints. They exist because the
// four write APIs are unusable without them: every write validates (type,
// subtype) against a user-editable collection, and effectiveDate depends on a
// cycle the caller cannot compute.
export const categoriesQuerySchema = z.object({
  kind: z.enum(['expense', 'income']).optional(),
});

export const cardCycleQuerySchema = z.object({
  brand: cardBrand,
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2000).max(2100),
});
