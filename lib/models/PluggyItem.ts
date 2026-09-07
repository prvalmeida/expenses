import mongoose from 'mongoose';

const PluggyItemSchema = new mongoose.Schema(
  {
    itemId: { type: String, required: true },
    connectorId: { type: Number, required: true },
    label: { type: String, required: true },
    status: { type: String, required: true },
    statusDetail: { type: String, required: false },
    lastPluggyUpdatedAt: { type: Date, required: false },
    lastCheckedAt: { type: Date, required: false },
    createdAt: { type: Date, required: true },
  },
  { strict: true }
);

PluggyItemSchema.index({ itemId: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).PluggyItem;
export const PluggyItem = mongoose.model('PluggyItem', PluggyItemSchema);
