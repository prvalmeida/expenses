import mongoose from 'mongoose';

// A single doc (`_id: 'singleton'`) used as an advisory lock so two
// overlapping triggers (cron, "sincronizar agora") can never both page the
// same account or both auto-import the same staged row. See
// pluggyService.withSyncLock for the acquire/staleness logic — there is no
// unique index to declare here, `_id` already is one.
const PluggySyncLockSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true },
    acquiredAt: { type: Date, required: true },
  },
  { strict: true }
);

delete (mongoose.models as Record<string, unknown>).PluggySyncLock;
export const PluggySyncLock = mongoose.model('PluggySyncLock', PluggySyncLockSchema);
