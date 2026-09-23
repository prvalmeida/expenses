import { migration as paymentTypes } from './001-payment-types';
import { migration as pluggyTransactionDates } from './002-pluggy-transaction-dates';
import { MigrationDefinition } from './types';

// The registry, in application order. Append only: a migration that has run
// somewhere is history, so it is never reordered, renamed or edited — a
// correction is a new migration.
export const migrations: MigrationDefinition[] = [paymentTypes, pluggyTransactionDates];

export type { MigrationDefinition };
