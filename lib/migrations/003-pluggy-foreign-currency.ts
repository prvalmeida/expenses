import Expense from '../models/Expense';
import { PluggyTransaction } from '../models/PluggyTransaction';
import { accountAmount, ACCOUNT_CURRENCY } from '../utils/pluggyUtils';
import { MigrationDefinition } from './types';

interface ForeignRow {
  _id: unknown;
  amount: number;
  status: string;
  importedExpenseIds?: string[];
  raw: { amount: number; currencyCode?: string; amountInAccountCurrency?: number | null };
}

// Money is compared in cents: the stored values went through JSON and
// Math.abs, and a float equality check would be one bad rounding from
// skipping a row it should have fixed.
function sameCents(a: number, b: number): boolean {
  return Math.round(a * 100) === Math.round(b * 100);
}

export const migration: MigrationDefinition = {
  name: '003-pluggy-foreign-currency',
  description:
    'Converte para R$ as transações Pluggy em moeda estrangeira (amountInAccountCurrency) e corrige os gastos já importados com o valor em dólar.',

  // Before mapPluggyTransaction learned about amountInAccountCurrency, a
  // purchase abroad was staged with Pluggy's `amount` — the value in the
  // merchant's currency — so a US$ 10 charge became an R$ 10,00 expense.
  // This restages those rows at the converted value and, for a row already
  // imported, rewrites the one Expense it produced.
  //
  // Must run before the next sync after deploy: upsertTransaction compares an
  // imported row's stored amount with the freshly-mapped (now converted) one,
  // and an unmigrated row would flip to 'anomaly' instead.
  //
  // An Expense is only rewritten when the row produced exactly one and its
  // value is still the unconverted amount — anything else (an installment
  // split, a value a human already corrected) is counted and left alone.
  async run({ dryRun }): Promise<Record<string, number>> {
    const rows = await PluggyTransaction.find({ currencyCode: { $ne: ACCOUNT_CURRENCY } })
      .select('amount status importedExpenseIds raw.amount raw.currencyCode raw.amountInAccountCurrency')
      .lean<ForeignRow[]>();

    const result = { rows: rows.length, restaged: 0, unconvertible: 0, expensesFixed: 0, expensesSkipped: 0 };

    for (const row of rows) {
      const converted = accountAmount(row.raw);
      if (converted.currencyCode !== ACCOUNT_CURRENCY) {
        result.unconvertible++;
        continue;
      }

      if (row.status === 'imported') {
        const ids = row.importedExpenseIds ?? [];
        const expense = ids.length === 1
          ? await Expense.findById(ids[0]).select('value').lean<{ value: number } | null>()
          : null;
        if (expense && sameCents(expense.value, Math.abs(row.amount))) {
          if (!dryRun) {
            await Expense.updateOne({ _id: ids[0] }, { $set: { value: Math.abs(converted.amount) } });
          }
          result.expensesFixed++;
        } else {
          result.expensesSkipped++;
        }
      }

      if (!dryRun) {
        await PluggyTransaction.updateOne(
          { _id: row._id },
          {
            $set: {
              amount: converted.amount,
              currencyCode: converted.currencyCode,
              originalAmount: converted.originalAmount,
              originalCurrencyCode: converted.originalCurrencyCode,
            },
          }
        );
      }
      result.restaged++;
    }

    return result;
  },
};
