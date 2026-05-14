import { CardBrand, ExpenseSubtypes } from '@/types';
import mongoose from 'mongoose';

// 1. Define the shape of your Document for the validator
interface IExpenseDocument {
  type: keyof typeof ExpenseSubtypes;
  subtype?: string;
}

// 2. Define the shape of the Props passed to the message function
interface ValidatorProps {
  value: string;
  path: string;
}

const ExpenseSchema = new mongoose.Schema({
    name: { type: String, required: true },
    value: { type: Number, required: true },
    type: { 
        type: String, 
        required: true, 
        enum: Object.keys(ExpenseSubtypes) 
    },
    subtype: {
        type: String,
        required: false,
        validate: {
          // Use the interface for 'this'
          validator: function(this: IExpenseDocument, v: string): boolean {
            if (!v) return true;
            
            const allowedSubtypes = ExpenseSubtypes[this.type] as unknown as string[];
            return Array.isArray(allowedSubtypes) && allowedSubtypes.includes(v);
          },
          // Use the interface for 'props'
          message: (props: ValidatorProps) => 
            `${props.value} não é um subtipo válido para esta categoria!`
        }
      },
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

if (mongoose.models.Expense) {
  delete mongoose.models.Expense;
}

export default mongoose.models.Expense || mongoose.model('Expense', ExpenseSchema);