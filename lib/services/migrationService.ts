import connectToDatabase from '../mongodb';
import { MigrationRecord } from '../models/Migration';
import { migrations } from '../migrations';

export type MigrationState = 'pending' | 'running' | 'completed' | 'failed';

export interface MigrationStatus {
  name: string;
  description: string;
  state: MigrationState;
  startedAt?: string;
  finishedAt?: string;
  result?: Record<string, number>;
  error?: string;
}

export interface MigrationRunReport {
  dryRun: boolean;
  applied: { name: string; result: Record<string, number> }[];
  skipped: string[];
  failed: { name: string; error: string } | null;
}

interface LedgerDocument {
  name: string;
  status: 'running' | 'completed' | 'failed';
  startedAt?: Date;
  finishedAt?: Date;
  result?: Record<string, number>;
  error?: string;
}

// Mongo signals a unique-index violation with code 11000. That is the ledger's
// "already claimed" answer, and the only error here that is not a fault.
function isDuplicateKey(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

async function ledger(): Promise<Map<string, LedgerDocument>> {
  const docs = await MigrationRecord.find({}).lean<LedgerDocument[]>();
  return new Map(docs.map(doc => [doc.name, doc]));
}

export async function listMigrations(): Promise<MigrationStatus[]> {
  await connectToDatabase();
  const applied = await ledger();

  return migrations.map(({ name, description }) => {
    const record = applied.get(name);
    if (!record) return { name, description, state: 'pending' as const };

    return {
      name,
      description,
      state: record.status,
      startedAt: record.startedAt?.toISOString(),
      finishedAt: record.finishedAt?.toISOString(),
      result: record.result,
      error: record.error,
    };
  });
}

export async function runPendingMigrations({
  dryRun = false,
}: { dryRun?: boolean } = {}): Promise<MigrationRunReport> {
  await connectToDatabase();

  // Building the unique index lazily on first write would leave the very first
  // run — the one most likely to be raced by an impatient second click —
  // unprotected. syncIndexes is idempotent and costs one command.
  await MigrationRecord.syncIndexes();

  const report: MigrationRunReport = { dryRun, applied: [], skipped: [], failed: null };
  const applied = dryRun ? await ledger() : null;

  for (const migration of migrations) {
    if (dryRun) {
      // A read-then-act check, which is exactly what the claim below avoids —
      // acceptable only because a dry run writes nothing either way.
      if (applied!.has(migration.name)) {
        report.skipped.push(migration.name);
        continue;
      }
      report.applied.push({
        name: migration.name,
        result: await migration.run({ dryRun: true }),
      });
      continue;
    }

    try {
      await MigrationRecord.create({
        name: migration.name,
        status: 'running',
        startedAt: new Date(),
      });
    } catch (error) {
      if (!isDuplicateKey(error)) throw error;
      // Already applied, in flight, or halted as `failed`. All three mean the
      // same thing to this run: not mine to do.
      report.skipped.push(migration.name);
      continue;
    }

    try {
      const result = await migration.run({ dryRun: false });
      await MigrationRecord.updateOne(
        { name: migration.name },
        { $set: { status: 'completed', finishedAt: new Date(), result } }
      );
      report.applied.push({ name: migration.name, result });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await MigrationRecord.updateOne(
        { name: migration.name },
        { $set: { status: 'failed', finishedAt: new Date(), error: message } }
      );
      report.failed = { name: migration.name, error: message };
      // Stop rather than continue: a later migration may assume this one ran,
      // and the ledger should record where the sequence actually broke. The
      // `failed` row keeps blocking until a human clears it.
      break;
    }
  }

  return report;
}
