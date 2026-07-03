import mongoose from 'mongoose';

const CategorySchema = new mongoose.Schema({
  kind: { type: String, required: true, enum: ['expense', 'income'] },
  name: { type: String, required: true },
  subtypes: { type: [String], default: [] },
  order: { type: Number, required: false },
});

CategorySchema.index({ kind: 1, name: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).Category;
export const Category = mongoose.model('Category', CategorySchema);
