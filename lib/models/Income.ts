import mongoose from 'mongoose';

const IncomeSchema = new mongoose.Schema({
    name: { type: String, required: true },
    value: { type: Number, required: true },
    type: { type: String, required: true },
    date: { type: String, required: true },
  },
  { 
    strict: true
  }
);

IncomeSchema.index({ date: -1, _id: -1 });
IncomeSchema.index({ type: 1 });

export default mongoose.models.Income || mongoose.model('Income', IncomeSchema);
