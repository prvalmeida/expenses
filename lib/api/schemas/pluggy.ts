import { z } from 'zod';
import { cardBrand, isoDate, paginationQuery, paymentType } from './common';

// Query strings are always strings, so z.coerce.boolean() is the wrong tool
// here: Boolean("false") is true, which would make ?dryRun=false behave like
// ?dryRun=true. This maps exactly "true"/"false" and treats an absent value
// as false, the same default the internal /api/admin/migrations route hard-codes.
const booleanQueryParam = z
  .enum(['true', 'false'])
  .optional()
  .transform(value => value === 'true');

export const PLUGGY_TRANSACTION_STATUSES = [
  'pending',
  'imported',
  'ignored',
  'skipped_existing',
  'anomaly',
] as const;

export const pluggyTransactionStatus = z.enum(PLUGGY_TRANSACTION_STATUSES);

// How far back a link row's start date may go. Open Finance serves roughly a
// year of history, so an older date would just be a window Pluggy answers
// short — and a silent short answer reads as "no transactions".
export const MAX_SYNC_LOOKBACK_DAYS = 365;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
}

// PluggyAccount.connectedAt — the day the fetch window starts. Bounds are read
// at parse time, never at module load, so they move with the calendar.
// The regex in isoDate admits 2026-02-31, which passes both string bounds and
// would be sent to Pluggy as `dateFrom` on every sync until someone edits it —
// so the value must round-trip through Date unchanged.
const syncStartDate = isoDate
  .refine(value => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
  }, 'Data inválida')
  .refine(value => value <= isoDaysAgo(0), 'A data de início não pode estar no futuro')
  .refine(
    value => value >= isoDaysAgo(MAX_SYNC_LOOKBACK_DAYS),
    `A data de início não pode ser anterior a ${MAX_SYNC_LOOKBACK_DAYS} dias atrás`
  );

// The cron target: POST /api/v1/pluggy/sync?dryRun=&accountId=. Omitting
// accountId syncs every enabled account.
export const syncPluggyQuerySchema = z.object({
  dryRun: booleanQueryParam,
  accountId: z.string().trim().min(1).optional(),
});

// The item is created in the browser by Pluggy Connect; this only registers
// the itemId our server is handed back, so a bank credential never transits
// this app (see pluggyService.registerItem).
export const registerPluggyItemSchema = z.object({
  itemId: z.string().trim().min(1, 'itemId é obrigatório'),
  label: z.string().trim().min(1, 'label é obrigatório'),
});

// Staged rows, keyset-paginated the same way listExpensesQuerySchema is.
export const listPluggyTransactionsQuerySchema = paginationQuery.extend({
  status: pluggyTransactionStatus.optional(),
  accountId: z.string().trim().min(1).optional(),
});

// The link row's PUT: `kind` is echoed back by the caller (it is immutable,
// read from Pluggy) so the refine below can enforce the credit ↔ cardBrand
// pairing the same way updateExpensePayloadSchema does — the service layer
// re-checks the echoed kind against the stored one before writing, the same
// distrust-the-caller rule updateExpense applies to a merged PATCH payload.
export const updateAccountLinkSchema = z
  .object({
    accountId: z.string().trim().min(1, 'accountId é obrigatório'),
    kind: z.enum(['BANK', 'CREDIT']),
    enabled: z.boolean(),
    cardBrand: cardBrand.optional(),
    // A BANK account defaulting to 'credit' would mint the cardBrand-less
    // credit document the refinement below exists to prevent.
    defaultPaymentType: paymentType.exclude(['credit']).optional(),
    defaultIncomeType: z.string().trim().min(1).optional(),
    // Unlike the three fields above, omitting this means "keep", not "clear":
    // connectedAt is required on the document (see updateAccountLink).
    connectedAt: syncStartDate.optional(),
  })
  .refine(input => input.kind !== 'CREDIT' || Boolean(input.cardBrand), {
    path: ['cardBrand'],
    message: 'cardBrand é obrigatório para uma conta CREDIT',
  });

// The manual review path: explicit rows a human classified, rather than a
// BillMapping hit or an account default.
const importPluggyStagedItemSchema = z
  .object({
    pluggyId: z.string().trim().min(1),
    kind: z.enum(['expense', 'income']),
    type: z.string().trim().min(1),
    subtype: z.string().trim().min(1).optional(),
    paymentType: paymentType.optional(),
    cardBrand: cardBrand.optional(),
    newMapping: z.boolean().optional(),
  })
  .refine(input => input.paymentType !== 'credit' || Boolean(input.cardBrand), {
    path: ['cardBrand'],
    message: 'cardBrand é obrigatório quando paymentType é credit',
  });

export const importPluggyStagedSchema = z.object({
  items: z.array(importPluggyStagedItemSchema).min(1, 'items é obrigatório'),
});

export type SyncPluggyQuery = z.infer<typeof syncPluggyQuerySchema>;
export type RegisterPluggyItemBody = z.infer<typeof registerPluggyItemSchema>;
export type ListPluggyTransactionsQuery = z.infer<typeof listPluggyTransactionsQuerySchema>;
export type UpdateAccountLinkBody = z.infer<typeof updateAccountLinkSchema>;
export type ImportPluggyStagedBody = z.infer<typeof importPluggyStagedSchema>;
