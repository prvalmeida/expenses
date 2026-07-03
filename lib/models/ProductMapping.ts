import mongoose from 'mongoose';

const ProductMappingSchema = new mongoose.Schema({
  cnpj: { type: String, required: true },
  address: { type: String },
  description: { type: String, required: true },
  type: { type: String, required: true },
  subtype: { type: String, required: false },
});

ProductMappingSchema.index({ cnpj: 1, address: 1, description: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).ProductMapping;
export const ProductMapping = mongoose.model('ProductMapping', ProductMappingSchema);
