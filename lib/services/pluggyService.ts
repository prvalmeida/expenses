import connectToDatabase from '../mongodb';
import { PluggyItem } from '../models/PluggyItem';
import { PluggyAccount } from '../models/PluggyAccount';
import { PluggyTransaction } from '../models/PluggyTransaction';
import { getItem, listAccounts, listTransactions, PluggyAccountApi, PluggyTransactionApi } from '../pluggy/client';
import { mapPluggyTransaction } from '../utils/pluggyUtils';
import { ApiError } from '../api/respond';

function today(): string {
  return new Date().toISOString().split('T')[0];
}

function toIsoDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

// Upserts PluggyItem from a fresh /items/:id read. `label` is only supplied by
// registerItem — a status-only refresh (refreshItemStatus) must not require it,
// since the document (and its label) already exists by then.
async function upsertItemFromApi(itemId: string, label?: string): Promise<{ status: string }> {
  const item = await getItem(itemId);

  const $set: Record<string, unknown> = {
    connectorId: item.connector?.id,
    status: item.status,
    lastCheckedAt: new Date(),
  };
  if (label !== undefined) $set.label = label;
  if (item.statusDetail) $set.statusDetail = item.statusDetail;
  if (item.updatedAt) $set.lastPluggyUpdatedAt = new Date(item.updatedAt);

  await PluggyItem.findOneAndUpdate(
    { itemId },
    { $set, $setOnInsert: { createdAt: new Date() } },
    { upsert: true }
  );

  return { status: item.status };
}

function accountFields(itemId: string, account: PluggyAccountApi): Record<string, unknown> {
  return {
    itemId,
    kind: account.type,
    name: account.marketingName ?? account.name,
    number: account.number ?? undefined,
  };
}

// Re-reads /accounts for an item and upserts a link row per account. Safe to
// call repeatedly (e.g. after linking a new bank under the same Meu Pluggy
// item): enabled/connectedAt are $setOnInsert only, so an already-configured
// account is never reset to disabled by a later refresh.
export async function refreshAccounts(itemId: string): Promise<{ accountsRegistered: number }> {
  await connectToDatabase();

  const { results } = await listAccounts(itemId);
  const accounts = results ?? [];
  const connectedAt = today();

  await Promise.all(
    accounts.map(account =>
      PluggyAccount.findOneAndUpdate(
        { accountId: account.id },
        {
          $set: accountFields(itemId, account),
          $setOnInsert: { enabled: false, connectedAt },
        },
        { upsert: true }
      )
    )
  );

  return { accountsRegistered: accounts.length };
}

// The item is created in the browser by Pluggy Connect (a short-lived connect
// token authorizes it); this registers the itemId our server is handed back,
// so a bank credential never transits this app.
export interface RegisterItemInput {
  itemId: string;
  label: string;
}

export interface RegisterItemResult {
  itemId: string;
  status: string;
  accountsRegistered: number;
}

export async function registerItem({ itemId, label }: RegisterItemInput): Promise<RegisterItemResult> {
  await connectToDatabase();

  const { status } = await upsertItemFromApi(itemId, label);
  const { accountsRegistered } = await refreshAccounts(itemId);

  return { itemId, status, accountsRegistered };
}

// Polls Pluggy for an item's current status (UPDATED / LOGIN_ERROR / ...)
// without touching its accounts. Used standalone (monitoring) and by syncAll,
// which refreshes every item's status before paging any account.
export async function refreshItemStatus(itemId: string): Promise<{ status: string }> {
  await connectToDatabase();
  return upsertItemFromApi(itemId);
}

// Card transactions post late and a PENDING row can still change, so the
// window always re-covers the last few days rather than starting exactly
// where the previous sync left off.
const DEFAULT_OVERLAP_DAYS = 5;
// A pagination bug (or a page that never shrinks) must not loop forever.
const MAX_SYNC_PAGES = 50;
const PAGE_SIZE = 100;

function computeSyncWindow(
  account: { connectedAt: string; lastSyncedAt?: Date | null },
  overlapDays: number
): { from: string; to: string } {
  const to = toIsoDate(new Date());
  if (!account.lastSyncedAt) return { from: account.connectedAt, to };

  const overlapMs = overlapDays * 24 * 60 * 60 * 1000;
  const overlapFrom = toIsoDate(new Date(account.lastSyncedAt.getTime() - overlapMs));
  // ISO YYYY-MM-DD strings compare correctly lexically, so this is just `max`.
  const from = overlapFrom > account.connectedAt ? overlapFrom : account.connectedAt;
  return { from, to };
}

export interface SyncAccountResult {
  accountId: string;
  fetched: number;
  created: number;
  updated: number;
  anomalies: number;
}

export type PluggyUpsertOutcome = 'created' | 'updated' | 'anomaly' | 'unchanged';

interface ExistingTransactionSnapshot {
  status: string;
  amount: number;
  date: string;
}

// The idempotency rule, keyed on pluggyId:
// - new                       -> insert as 'pending'.
// - existing, pending/ignored -> refresh raw fields, bump lastSeenAt.
// - existing, imported        -> raw fields are NEVER touched. If amount or
//   date drifted since import, flag 'anomaly' and leave the Expense alone —
//   editing an already-posted expense is a decision for a human, not a poller.
// - existing, anything else (skipped_existing / already anomaly) -> a human or
//   a later phase already decided this row's fate; a resync must not revisit it.
async function upsertTransaction(
  tx: PluggyTransactionApi,
  account: { accountId: string; itemId: string },
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<PluggyUpsertOutcome> {
  const fields = mapPluggyTransaction(tx);
  const existing = await PluggyTransaction.findOne({ pluggyId: tx.id })
    .select('status amount date')
    .lean<ExistingTransactionSnapshot | null>();

  if (!existing) {
    if (!dryRun) {
      const now = new Date();
      await PluggyTransaction.create({
        pluggyId: tx.id,
        accountId: account.accountId,
        itemId: account.itemId,
        ...fields,
        status: 'pending',
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    return 'created';
  }

  if (existing.status === 'imported') {
    const changed = existing.amount !== fields.amount || existing.date !== fields.date;
    if (!changed) return 'unchanged';
    if (!dryRun) {
      await PluggyTransaction.updateOne(
        { pluggyId: tx.id },
        { $set: { status: 'anomaly', statusReason: 'Valor ou data mudaram após a importação.' } }
      );
    }
    return 'anomaly';
  }

  if (existing.status === 'pending' || existing.status === 'ignored') {
    if (!dryRun) {
      await PluggyTransaction.updateOne(
        { pluggyId: tx.id },
        { $set: { ...fields, lastSeenAt: new Date() } }
      );
    }
    return 'updated';
  }

  return 'unchanged';
}

// Fetches one enabled account's transactions into staging. `lastSyncedAt` only
// advances once the whole account has succeeded — a page that fails partway
// through must be re-fetched next run, and the overlap window alone is not a
// guarantee if the failure outlasted it.
export async function syncAccount(
  accountId: string,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<SyncAccountResult> {
  await connectToDatabase();

  const account = await PluggyAccount.findOne({ accountId });
  if (!account) throw new ApiError('VALIDATION_FAILED', `Conta Pluggy desconhecida: ${accountId}`);
  if (!account.enabled) throw new ApiError('VALIDATION_FAILED', `Conta Pluggy desabilitada: ${accountId}`);

  // Read inside the function, never at module scope — see client.ts.
  const overlapDays = Number(process.env.PLUGGY_SYNC_OVERLAP_DAYS ?? DEFAULT_OVERLAP_DAYS);
  const { from, to } = computeSyncWindow(account, overlapDays);

  const result: SyncAccountResult = { accountId, fetched: 0, created: 0, updated: 0, anomalies: 0 };

  for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
    const { results: rows } = await listTransactions({ accountId, from, to, page, pageSize: PAGE_SIZE });
    result.fetched += rows.length;

    // dryRun still classifies each row (a DB read) so the report reflects what
    // would happen, but upsertTransaction writes nothing when dryRun is set —
    // the same contract a migration's dry run has.
    for (const tx of rows) {
      const outcome = await upsertTransaction(tx, account, { dryRun });
      if (outcome === 'created') result.created++;
      else if (outcome === 'updated') result.updated++;
      else if (outcome === 'anomaly') result.anomalies++;
    }

    if (rows.length < PAGE_SIZE) break;
  }

  if (!dryRun) {
    account.lastSyncedAt = new Date();
    await account.save();
  }

  return result;
}
