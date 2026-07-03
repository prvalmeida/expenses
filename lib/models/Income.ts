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

export default mongoose.models.Income || mongoose.model('Income', IncomeSchema);