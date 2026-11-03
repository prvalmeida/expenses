import mongoose from 'mongoose';

// A human's "ignorar nas próximas sincronizações" on ONE staged transaction —
// typically a store purchase already booked item by item from the receipt,
// whose card row must never be imported as a lump sum.
//
// Kept apart from PluggyTransaction because it has to outlive the row it was
// made on: Pluggy can reissue a transaction under a new id (pending -> posted),
// and a new pluggyId is a brand-new staging row. The fingerprint
// (accountId + description + date + amount) is what recognizes the reissued
// row; `date` is part of it on purpose, so a later purchase at the same store
// is NOT ignored.
const PluggyIgnoreSchema = new mongoose.Schema(
  {
    pluggyId: { type: String, required: true },
    accountId: { type: String, required: true },
    description: { type: String, required: true },
    date: { type: String, required: true }, // YYYY-MM-DD, PluggyTransaction.date
    amount: { type: Number, required: true }, // PluggyTransaction.amount, signed
    createdAt: { type: Date, required: true },
  },
  { strict: true }
);

PluggyIgnoreSchema.index({ pluggyId: 1 }, { unique: true });
PluggyIgnoreSchema.index({ accountId: 1, date: 1, description: 1 });

delete (mongoose.models as Record<string, unknown>).PluggyIgnore;
export const PluggyIgnore = mongoose.model('PluggyIgnore', PluggyIgnoreSchema);
