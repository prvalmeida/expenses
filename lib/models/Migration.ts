import mongoose from 'mongoose';

// The migration ledger: one document per migration that has been attempted.
//
// The unique index on `name` is the entire mechanism. A migration does not read
// "have I run before?" and then act — that gap is where a double-run lives.
// It inserts its own name first, and a duplicate-key error *is* the answer.
// Once-ness is enforced by the database rather than by whoever remembers.
//
// There is no transaction around "do the work" and "mark it completed":
// multi-document transactions require a replica set and the deployment runs a
// standalone mongod. The ordering is chosen so the unsafe outcome is the
// visible one — a process that dies mid-migration leaves `running` behind and
// blocks the next attempt, instead of silently repeating a destructive rewrite.
const MigrationSchema = new mongoose.Schema({
  name: { type: String, required: true },
  status: { type: String, required: true, enum: ['running', 'completed', 'failed'] },
  startedAt: { type: Date, required: true },
  finishedAt: { type: Date, required: false },
  result: { type: mongoose.Schema.Types.Mixed, required: false },
  error: { type: String, required: false },
});

MigrationSchema.index({ name: 1 }, { unique: true });

delete (mongoose.models as Record<string, unknown>).Migration;
export const MigrationRecord = mongoose.model('Migration', MigrationSchema);
