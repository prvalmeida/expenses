import mongoose from 'mongoose';
import { CardBrand } from '@/types';

// Staging collection — the only thing in the app that knows about Pluggy.
// `Expense`/`Income` gain no new field; the link back to what was imported
// lives on this side (`importedExpenseIds`/`importedIncomeId`).
const PluggyTransactionSchema = new mongoose.Schema(
  {
    pluggyId: { type: String, required: true },
    accountId: { type: String, required: true },
    itemId: { type: String, required: true },

    // --- raw, as returned by Pluggy; never edited once status is 'imported' ---
    date: { type: String, required: true },
    amount: { type: Number, required: true },
    currencyCode: { type: String, required: true },
    descriptionRaw: { type: String, required: true },
    description: { type: String, required: true },
    merchantName: { type: String, required: false },
    pluggyCategory: { type: String, required: false },
    pluggyStatus: { type: String, required: true },
    installmentCurrent: { type: Number, required: false },
    installmentTotal: { type: Number, required: false },
    // YYYY-MM-DD. The original purchase date Pluggy reports on a card row
    // (creditCardMetadata.purchaseDate), which `date` is NOT — see
    // anchorPurchaseDate. Absent on bank rows and on connectors that omit it.
    purchaseDate: { type: String, required: false },
    paymentMethod: { type: String, required: false },
    // `strict: true` drops an untyped object outright; kept for debugging a bad
    // derivation against what Pluggy actually sent.
    raw: { type: mongoose.Schema.Types.Mixed, required: true },

    // --- derived by the payment-type/direction ladder (pluggyUtils.ts) ---
    direction: { type: String, enum: ['outflow', 'inflow'], required: false },
    paymentType: { type: String, required: false },
    cardBrand: { type: String, enum: Object.values(CardBrand), required: false },

    // --- our state ---
    status: {
      type: String,
      required: true,
      enum: ['pending', 'imported', 'ignored', 'skipped_existing', 'anomaly'],
      default: 'pending',
    },
    statusReason: { type: String, required: false },
    // Set by the review screen's "não ignorar" action. A resync re-derives
    // direction/paymentType/status on every pending/ignored row, and without
    // this flag that re-derive would silently re-ignore the row: the ignore
    // rules match on the description/counterparty, which never changes, so
    // the human's override would be a no-op past the next sync. When set, the
    // ignore step is skipped and the row stays 'pending'.
    ignoreOverridden: { type: Boolean, required: true, default: false },
    suggestedType: { type: String, required: false },
    suggestedSubtype: { type: String, required: false },
    importedExpenseIds: { type: [String], required: false },
    importedIncomeId: { type: String, required: false },
    firstSeenAt: { type: Date, required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { strict: true }
);

PluggyTransactionSchema.index({ pluggyId: 1 }, { unique: true });
// The review screen's only query.
PluggyTransactionSchema.index({ status: 1, date: -1 });
PluggyTransactionSchema.index({ accountId: 1, date: -1 });

delete (mongoose.models as Record<string, unknown>).PluggyTransaction;
export const PluggyTransaction = mongoose.model('PluggyTransaction', PluggyTransactionSchema);
