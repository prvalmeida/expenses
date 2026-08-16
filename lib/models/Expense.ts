import { CardBrand } from '@/types';
import mongoose from 'mongoose';

const ExpenseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    value: { type: Number, required: true },
    type: { type: String, required: true },
    subtype: { type: String, required: false },
    paymentType: { type: String, required: true },
    date: { type: String, required: true },
    effectiveDate: { type: String, required: true },
    transactionId: { type: String, required: false },
    installment: { type: Number, required: false },
    totalInstallments: {type: Number, required: false},
    cardBrand: {type: String, enum: Object.values(CardBrand), required: false},
    qty: { type: Number, required: false },
    unit: { type: String, required: false }
  },
  {
    strict: true // This ensures only schema fields are saved
  }
);

// Every v1 list filter is a collection scan without these. The date indexes
// carry _id as a tie-break because listExpenses sorts on (dateField, _id) —
// a single-field index would leave the sort in memory.
ExpenseSchema.index({ date: -1, _id: -1 });
ExpenseSchema.index({ effectiveDate: -1, _id: -1 });
ExpenseSchema.index({ transactionId: 1 });
ExpenseSchema.index({ type: 1, subtype: 1 });

if (mongoose.models.Expense) {
  delete mongoose.models.Expense;
}

export default mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);
