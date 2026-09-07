import mongoose from 'mongoose';
import { CardBrand } from '@/types';

const PluggyAccountSchema = new mongoose.Schema(
  {
    accountId: { type: String, required: true },
    itemId: { type: String, required: true },
    kind: { type: String, required: true, enum: ['BANK', 'CREDIT'] },
    name: { type: String, required: true },
    number: { type: String, required: false },
    // false = fetched into staging but never imported. Accounts start disabled:
    // enabling one is the act of picking its cardBrand/defaultPaymentType.
    enabled: { type: Boolean, required: true, default: false },
    // CREDIT only. Expense.cardBrand, CardCycle.cardBrand and cycleUtils'
    // DEFAULT_SETTINGS all key off the CardBrand enum, so a linked card must map
    // onto one of its three values.
    cardBrand: { type: String, enum: Object.values(CardBrand), required: false },
    // BANK only. Used when the payment-type ladder cannot narrow further.
    defaultPaymentType: { type: String, required: false },
    // BANK only, optional. Unset means every inflow on this account goes to review.
    defaultIncomeType: { type: String, required: false },
    // YYYY-MM-DD. No transaction dated before this is ever fetched.
    connectedAt: { type: String, required: true },
    // High-water mark for the fetch window.
    lastSyncedAt: { type: Date, required: false },
  },
  { strict: true }
);

PluggyAccountSchema.index({ accountId: 1 }, { unique: true });
PluggyAccountSchema.index({ itemId: 1 });

delete (mongoose.models as Record<string, unknown>).PluggyAccount;
export const PluggyAccount = mongoose.model('PluggyAccount', PluggyAccountSchema);
