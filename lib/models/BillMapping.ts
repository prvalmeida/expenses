import mongoose from 'mongoose';
import { ExpenseSubtypes } from '@/types';

const BillMappingSchema = new mongoose.Schema({
  description: { type: String, required: true },
  type: { type: String, required: true, enum: Object.keys(ExpenseSubtypes) },
  subtype: { type: String, required: false },
});

BillMappingSchema.index({ description: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).BillMapping;
export const BillMapping = mongoose.model('BillMapping', BillMappingSchema);
