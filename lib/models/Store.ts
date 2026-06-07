import mongoose from 'mongoose';
import { ExpenseSubtypes } from '@/types';

const StoreSchema = new mongoose.Schema({
  cnpj: { type: String, required: true },
  name: { type: String, required: true },
  address: { type: String },
  defaultType: { type: String, enum: Object.keys(ExpenseSubtypes) },
});

StoreSchema.index({ cnpj: 1, address: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).Store;
export const Store = mongoose.model('Store', StoreSchema);
