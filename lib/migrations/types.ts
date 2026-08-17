// A migration is a named, ordered, run-once operation on stored data.
//
// `run` reports counts rather than returning void: the numbers are written to
// the ledger, so what a migration did to production stays inspectable long
// after the console output is gone.
export interface MigrationDefinition {
  // Stable and unique — it is the ledger key. Never rename an applied
  // migration; a renamed one is an unapplied one as far as the ledger knows.
  name: string;
  description: string;
  // `dryRun` must report the same counts it would have written, without
  // writing. A migration that cannot preview honestly should say so rather
  // than pretend.
  run(options: { dryRun: boolean }): Promise<Record<string, number>>;
}
