import Expense from '../models/Expense';
import { MigrationDefinition } from './types';

// Applied in order, and the order is load-bearing: `cash` → `pix` must run
// before `other` → `cash`, or the rows renamed to `cash` would be renamed again
// to `pix`. Sequential by construction — never Promise.all.
const STEPS = [
  { from: 'cash', to: 'pix' },
  { from: 'other', to: 'cash' },
] as const;

export const migration: MigrationDefinition = {
  name: '001-payment-types',
  description:
    'Corrige os valores de paymentType: o formulário gravava PIX como "cash" e Dinheiro como "other".',

  // This is the migration the ledger exists for. It rewrites every matching row
  // and has no natural empty-state check, so a second run would remap genuine
  // Dinheiro records to PIX — the ledger is what makes that unreachable.
  async run({ dryRun }) {
    const result: Record<string, number> = {};

    for (const step of STEPS) {
      const key = `${step.from}->${step.to}`;
      if (dryRun) {
        result[key] = await Expense.countDocuments({ paymentType: step.from });
        continue;
      }

      const { modifiedCount } = await Expense.updateMany(
        { paymentType: step.from },
        { $set: { paymentType: step.to } }
      );
      result[key] = modifiedCount;
    }

    return result;
  },
};
