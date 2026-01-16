import mongoose from 'mongoose';
import { CardBrand } from '@/types';

const CardCycleSchema = new mongoose.Schema({
  cardBrand: { type: String, required: true, enum: Object.values(CardBrand) },
  month: { type: Number, required: true }, // 1-12
  year: { type: Number, required: true },
  closingDate: { type: Date, required: true }, // The specific cutoff day
  dueDate: { type: Date, required: true },     // The specific payment day
});

export const CardCycle = mongoose.models.CardCycle || mongoose.model('CardCycle', CardCycleSchema);