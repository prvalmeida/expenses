import mongoose from 'mongoose';

const BillMappingSchema = new mongoose.Schema({
  description: { type: String, required: true },
  type: { type: String, required: true },
  subtype: { type: String, required: false },
});

BillMappingSchema.index({ description: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).BillMapping;
export const BillMapping = mongoose.model('BillMapping', BillMappingSchema);
