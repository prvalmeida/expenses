import { PluggyTransaction } from '../models/PluggyTransaction';
import { MigrationDefinition } from './types';

// Rows staged before mapPluggyTransaction narrowed the field store Pluggy's
// full ISO timestamp ("2026-08-14T03:00:00.000Z"); everything that reads
// PluggyTransaction.date treats it as YYYY-MM-DD.
const HAS_TIMESTAMP = { $regex: 'T' };

// `$split` then `$arrayElemAt` rather than a JS round-trip: the rewrite is one
// updateMany with an aggregation pipeline, so it never loads the collection.
function narrowField(field: string) {
  return { $arrayElemAt: [{ $split: [`$${field}`, 'T'] }, 0] };
}

export const migration: MigrationDefinition = {
  name: '002-pluggy-transaction-dates',
  description:
    'Normaliza PluggyTransaction.date/purchaseDate para YYYY-MM-DD nas linhas gravadas com timestamp completo.',

  // Two failures motivate this, both of them silent:
  //  - upsertTransaction's drift check compares the stored date against the
  //    freshly-narrowed one, so an already-imported row inside the overlap
  //    window flips to 'anomaly' ("Valor ou data mudaram após a importação")
  //    even though nothing upstream changed.
  //  - listPluggyTransactions paginates by comparing `date` lexically, and a
  //    timestamp sorts after the bare date for the same day — a collection
  //    holding both formats can skip or repeat rows across a page boundary.
  // Idempotent on its own (a second pass matches nothing), but it is in the
  // ledger because it must be *known* to have run before a sync touches a
  // mixed-format collection.
  async run({ dryRun }): Promise<Record<string, number>> {
    const matched = await PluggyTransaction.countDocuments({
      $or: [{ date: HAS_TIMESTAMP }, { purchaseDate: HAS_TIMESTAMP }],
    });
    if (dryRun) return { rows: matched };

    const { modifiedCount } = await PluggyTransaction.updateMany(
      { $or: [{ date: HAS_TIMESTAMP }, { purchaseDate: HAS_TIMESTAMP }] },
      [
        {
          $set: {
            date: narrowField('date'),
            // $set on a missing field would create it; the $cond keeps a row
            // without a purchaseDate exactly as it was.
            purchaseDate: {
              $cond: [
                { $ifNull: ['$purchaseDate', false] },
                narrowField('purchaseDate'),
                '$purchaseDate',
              ],
            },
          },
        },
      ]
    );

    return { rows: matched, modified: modifiedCount };
  },
};
