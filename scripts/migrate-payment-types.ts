/**
 * One-off migration for the payment-type option-value fix.
 *
 * The expense form used to store PIX as `cash` and Dinheiro as `other`. Both
 * screens now store PIX as `pix` and Dinheiro as `cash`, so every already-stored
 * row means something different than it reads: a `cash` record was a PIX
 * payment, and `other` is not a payment type the API accepts at all — a v1
 * PUT/PATCH on such a record returns VALIDATION_FAILED, and the edit modal shows
 * an empty payment select.
 *
 * Order matters: `cash` → `pix` must run before `other` → `cash`, or the rows
 * renamed to `cash` would be renamed again to `pix`. The two updateMany calls
 * are therefore sequential, never Promise.all.
 *
 * Run once, against the same database the app uses:
 *
 *   npm run migrate:payment-types            # apply
 *   npm run migrate:payment-types -- --dry-run   # count only, no writes
 *
 * Idempotent after the first run only in the sense that a second run finds no
 * `other` rows — but it would re-map any genuinely new `cash` (Dinheiro) record
 * to `pix`, so do not run it twice. Check the reported counts.
 */
import mongoose from 'mongoose';
import Expense from '../lib/models/Expense';

const DRY_RUN = process.argv.includes('--dry-run');

// Applied in order. Each step is a complete rename of one legacy value.
const STEPS = [
  { from: 'cash', to: 'pix', label: 'PIX (armazenado como "cash")' },
  { from: 'other', to: 'cash', label: 'Dinheiro (armazenado como "other")' },
] as const;

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('Please define MONGODB_URI in .env.local');

  await mongoose.connect(uri);
  console.log(`Conectado. Modo: ${DRY_RUN ? 'dry-run (nenhuma escrita)' : 'aplicar'}\n`);

  for (const step of STEPS) {
    const count = await Expense.countDocuments({ paymentType: step.from });
    if (DRY_RUN) {
      console.log(`${step.label}: ${count} registro(s) seriam alterados para "${step.to}".`);
      continue;
    }

    const { modifiedCount } = await Expense.updateMany(
      { paymentType: step.from },
      { $set: { paymentType: step.to } }
    );
    console.log(`${step.label}: ${modifiedCount}/${count} alterado(s) para "${step.to}".`);
  }

  // Anything left outside the accepted set is a record the API will reject; it
  // is reported rather than guessed at.
  const accepted = ['credit', 'cash', 'debit', 'pix', 'food-voucher', 'meal-voucher', 'fuel-voucher'];
  const remaining = await Expense.distinct('paymentType', { paymentType: { $nin: accepted } });
  if (remaining.length) {
    console.warn(`\nAtenção: valores de paymentType ainda não reconhecidos: ${remaining.join(', ')}`);
  }

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
