/**
 * Runs pending data migrations from a full checkout — the development and
 * recovery path. Production goes through `POST /api/admin/migrations`, because
 * the standalone runner image ships no scripts and no installable driver.
 *
 * Both paths call the same service, so the ledger is shared: a migration
 * applied here is skipped there, and the reverse.
 *
 *   npm run migrate -- --dry-run   # counts only, writes nothing
 *   npm run migrate                # apply
 *   npm run migrate -- --status    # what has run, and what it did
 *
 * Safe to run repeatedly: the ledger's unique index makes a second run a no-op.
 */
import mongoose from 'mongoose';
import { listMigrations, runPendingMigrations } from '../lib/services/migrationService';

const DRY_RUN = process.argv.includes('--dry-run');
const STATUS_ONLY = process.argv.includes('--status');

async function showStatus() {
  for (const m of await listMigrations()) {
    const detail = m.result ? ` ${JSON.stringify(m.result)}` : m.error ? ` — ${m.error}` : '';
    console.log(`${m.state.padEnd(9)} ${m.name}${detail}`);
  }
}

async function main() {
  if (!process.env.MONGODB_URI) throw new Error('Please define MONGODB_URI in .env.local');

  if (STATUS_ONLY) {
    await showStatus();
    await mongoose.disconnect();
    return;
  }

  console.log(`Modo: ${DRY_RUN ? 'dry-run (nenhuma escrita)' : 'aplicar'}\n`);
  const report = await runPendingMigrations({ dryRun: DRY_RUN });

  for (const { name, result } of report.applied) {
    const counts = Object.entries(result)
      .map(([step, n]) => `${step}: ${n}`)
      .join(', ');
    console.log(`${DRY_RUN ? 'pendente' : 'aplicada'}  ${name} — ${counts || 'nada a fazer'}`);
  }
  for (const name of report.skipped) {
    console.log(`já aplicada ${name}`);
  }

  if (report.failed) {
    console.error(`\nFALHOU ${report.failed.name}: ${report.failed.error}`);
    console.error('A migração ficou marcada como "failed" e bloqueia as seguintes até ser revisada.');
    await mongoose.disconnect();
    process.exit(1);
  }

  if (!report.applied.length && !report.skipped.length) console.log('Nenhuma migração registrada.');

  await mongoose.disconnect();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
