import mongoose from 'mongoose';

const StoreSchema = new mongoose.Schema({
  cnpj: { type: String, required: true },
  name: { type: String, required: true },
  address: { type: String },
});

StoreSchema.index({ cnpj: 1, address: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).Store;
export const Store = mongoose.model('Store', StoreSchema);
