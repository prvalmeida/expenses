import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import Income from '../models/Income';
import { createIncome } from './incomeService';
import { PluggyItem } from '../models/PluggyItem';
import { PluggyAccount } from '../models/PluggyAccount';
import { PluggyTransaction } from '../models/PluggyTransaction';
import { PluggySyncLock } from '../models/PluggySyncLock';
import { BillMapping } from '../models/BillMapping';
import getOpenAI from '../openai';
import {
  createConnectToken,
  drainCursor,
  getItem,
  listAccounts,
  listTransactions,
  patchItem,
  PluggyAccountApi,
  PluggyTransactionApi,
} from '../pluggy/client';
import {
  mapPluggyTransaction,
  deriveDirection,
  derivePaymentType,
  shouldIgnore,
  resolveInstallmentPlan,
  toIsoDate as narrowIsoDate,
  computeSyncWindow,
  PluggyAccountLike,
  suggestionBatch,
  validSuggestionAnswers,
  SuggestionSource,
} from '../utils/pluggyUtils';
import { billMappingKey } from '../utils/billUtils';
import {
  getExpenseCategories,
  getIncomeCategories,
  validateExpensePair,
  validateIncomeType,
} from '../utils/categoryUtils';
import { buildExpenseDocuments, ExpenseDocument } from './expenseService';
import { ApiError } from '../api/respond';

function today(): string {
  return new Date().toISOString().split('T')[0];
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
// without touching its accounts. Used standalone (monitoring) and by
// syncAllAccounts, which refreshes every item's status before paging any account.
export async function refreshItemStatus(itemId: string): Promise<{ status: string }> {
  await connectToDatabase();
  return upsertItemFromApi(itemId);
}

// Item health, for monitoring — the last status this app observed, not a
// fresh Pluggy read (refreshItemStatus/syncAllAccounts already keep it current).
export async function listItems() {
  await connectToDatabase();
  return PluggyItem.find({}).sort({ label: 1 }).lean();
}

// Mints the short-lived widget token Pluggy Connect uses to create an item in
// the browser, so a bank credential never transits this app. Returned as-is —
// the value and nothing else.
export async function mintConnectToken(): Promise<{ accessToken: string }> {
  return createConnectToken();
}

// The link rows across every item, for the config screen.
export async function listAccountLinks() {
  await connectToDatabase();
  return PluggyAccount.find({}).sort({ itemId: 1, name: 1 }).lean();
}

export interface UpdateAccountLinkInput {
  accountId: string;
  kind: 'BANK' | 'CREDIT';
  enabled: boolean;
  cardBrand?: string;
  defaultPaymentType?: string;
  defaultIncomeType?: string;
  connectedAt?: string;
}

// `kind` is immutable and read from Pluggy, never chosen by a caller — the
// schema-level refine only checks the shape of what was claimed, so this
// re-checks the claimed kind against the stored one before writing, the same
// distrust-the-caller rule updateExpense applies to a merged PATCH payload.
// The three optional fields are $unset when omitted, matching updateExpense's
// PUT-is-a-full-replace rule: leaving one out means "clear it", not "keep it".
// `connectedAt` is the exception — it is required on the document, so omitting
// it means "keep". Moving it EARLIER also unsets lastSyncedAt: otherwise the
// window would still start at lastSyncedAt − overlap and the days between the
// new start date and that point would never be fetched. Moving it LATER parks
// the account's still-pending rows dated before it as 'ignored': the fetch
// window alone only stops new rows, and a pending row is still auto-imported
// (autoImportExpenses reads every pending row of an enabled account) and still
// offered for manual import — which re-books exactly the days a PDF bill
// already covered, the duplication moving the date later is meant to prevent.
// 'ignored' rather than deleted keeps them visible and one click from
// un-ignoring; moving the date back earlier re-fetches them and the resync
// re-derivation (upsertTransaction) returns them to pending.
export async function updateAccountLink(input: UpdateAccountLinkInput) {
  await connectToDatabase();

  const existing = await PluggyAccount.findOne({ accountId: input.accountId }).select('kind connectedAt');
  if (!existing) return null;

  if (existing.kind !== input.kind) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `kind não corresponde à conta: esperado ${existing.kind}, recebido ${input.kind}`
    );
  }

  const $set: Record<string, unknown> = { enabled: input.enabled };
  const $unset: Record<string, ''> = {};

  if (input.cardBrand !== undefined) $set.cardBrand = input.cardBrand;
  else $unset.cardBrand = '';

  if (input.defaultPaymentType !== undefined) $set.defaultPaymentType = input.defaultPaymentType;
  else $unset.defaultPaymentType = '';

  if (input.defaultIncomeType !== undefined) $set.defaultIncomeType = input.defaultIncomeType;
  else $unset.defaultIncomeType = '';

  const movedLater =
    input.connectedAt !== undefined && input.connectedAt > existing.connectedAt;
  if (input.connectedAt !== undefined && input.connectedAt !== existing.connectedAt) {
    $set.connectedAt = input.connectedAt;
    if (input.connectedAt < existing.connectedAt) $unset.lastSyncedAt = '';
  }

  const updated = await PluggyAccount.findOneAndUpdate(
    { accountId: input.accountId },
    { $set, $unset },
    { new: true }
  );

  if (movedLater) {
    // `date` is YYYY-MM-DD (or a full timestamp on rows migration 002 has not
    // rewritten yet), so a lexical `$lt` against the new start date is exact
    // for both. ignoreOverridden is left as-is: it records a human's decision
    // about the ignore RULES, which this is not.
    await PluggyTransaction.updateMany(
      { accountId: input.accountId, status: 'pending', date: { $lt: input.connectedAt } },
      { $set: { status: 'ignored', statusReason: BEFORE_START_DATE_REASON } }
    );
  }

  return updated;
}

const BEFORE_START_DATE_REASON =
  'Anterior à data de início da conta — o período já foi lançado (ex.: pela fatura em PDF).';

// How many days each sync re-covers past lastSyncedAt (computeSyncWindow).
const DEFAULT_OVERLAP_DAYS = 5;
// A pagination bug (or a cursor that never advances) must not loop forever.
// v2 fixes the page at 500 rows and rejects `pageSize` outright, so this is a
// ceiling of 25k transactions per account per sync — far beyond any real
// window, and the loop only runs while Pluggy keeps handing back a cursor.
const MAX_SYNC_PAGES = 50;

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
  ignoreOverridden: boolean;
}

interface StagingDerivation {
  direction?: 'outflow' | 'inflow';
  paymentType?: string;
  cardBrand?: string;
  status: 'pending' | 'ignored' | 'anomaly';
  statusReason?: string;
}

// Direction, payment type/cardBrand and the ignore rules, computed through the
// pure ladders in pluggyUtils.ts: direction first (an unresolved cross-check
// short-circuits to 'anomaly' before anything else runs), then payment type,
// then the double-counting guard. `skipIgnore` is set once a human has
// un-ignored this row (PluggyTransaction.ignoreOverridden) — the ignore
// signal (description/counterparty) never changes, so re-running it here
// would silently overturn that decision on every resync.
function deriveStaging(
  tx: PluggyTransactionApi,
  account: PluggyAccountLike,
  linkedAccountIds: ReadonlySet<string>,
  { skipIgnore = false }: { skipIgnore?: boolean } = {}
): StagingDerivation {
  const { direction, anomalyReason } = deriveDirection(tx, account);
  if (!direction) {
    return { status: 'anomaly', statusReason: anomalyReason };
  }

  const { paymentType, cardBrand } = derivePaymentType(tx, account);
  if (!skipIgnore) {
    const ignore = shouldIgnore(tx, account, direction, { linkedAccountIds });
    if (ignore.ignored) {
      return { direction, paymentType, cardBrand, status: 'ignored', statusReason: `${ignore.ruleId}: ${ignore.reason}` };
    }
  }

  return { direction, paymentType, cardBrand, status: 'pending' };
}

function stagingSetFields(staging: StagingDerivation): Record<string, unknown> {
  return {
    ...(staging.direction !== undefined && { direction: staging.direction }),
    ...(staging.paymentType !== undefined && { paymentType: staging.paymentType }),
    ...(staging.cardBrand !== undefined && { cardBrand: staging.cardBrand }),
    status: staging.status,
  };
}

// The idempotency rule, keyed on pluggyId:
// - new                       -> insert as 'pending' (or 'anomaly' if the
//   direction ladder cannot resolve without a guess).
// - existing, pending/ignored -> refresh raw fields, re-derive, bump lastSeenAt.
// - existing, imported        -> raw fields are NEVER touched. If amount or
//   date drifted since import, flag 'anomaly' and leave the Expense alone —
//   editing an already-posted expense is a decision for a human, not a poller.
// - existing, anything else (skipped_existing / already anomaly) -> a human or
//   a later phase already decided this row's fate; a resync must not revisit it.
async function upsertTransaction(
  tx: PluggyTransactionApi,
  account: PluggyAccountLike & { accountId: string; itemId: string },
  linkedAccountIds: ReadonlySet<string>,
  { dryRun = false }: { dryRun?: boolean } = {}
): Promise<PluggyUpsertOutcome> {
  const fields = mapPluggyTransaction(tx);
  const existing = await PluggyTransaction.findOne({ pluggyId: tx.id })
    .select('status amount date ignoreOverridden')
    .lean<ExistingTransactionSnapshot | null>();

  if (!existing) {
    const staging = deriveStaging(tx, account, linkedAccountIds);
    if (!dryRun) {
      const now = new Date();
      await PluggyTransaction.create({
        pluggyId: tx.id,
        accountId: account.accountId,
        itemId: account.itemId,
        ...fields,
        ...stagingSetFields(staging),
        ...(staging.statusReason !== undefined && { statusReason: staging.statusReason }),
        firstSeenAt: now,
        lastSeenAt: now,
      });
    }
    return staging.status === 'anomaly' ? 'anomaly' : 'created';
  }

  if (existing.status === 'imported') {
    // toIsoDate on the stored side too: rows staged before mapPluggyTransaction
    // narrowed `date` hold a full timestamp until migration
    // 002-pluggy-transaction-dates rewrites them, and comparing the two
    // formats directly would flag every one of them as drifted on the first
    // sync after deploy.
    const changed =
      existing.amount !== fields.amount || narrowIsoDate(existing.date) !== fields.date;
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
    const staging = deriveStaging(tx, account, linkedAccountIds, { skipIgnore: existing.ignoreOverridden });
    if (!dryRun) {
      const $set: Record<string, unknown> = { ...fields, ...stagingSetFields(staging), lastSeenAt: new Date() };
      const $unset: Record<string, ''> = {};
      if (staging.statusReason !== undefined) $set.statusReason = staging.statusReason;
      else $unset.statusReason = '';

      // The filter re-asserts the `ignoreOverridden` value this derivation was
      // computed from: a human un-ignoring the row (PATCH /transactions/[id])
      // between the read above and this write would otherwise be silently
      // stomped back to `ignored` by a derivation that predates their click.
      // Matching zero rows is the correct outcome — the next sync re-derives
      // from the new flag.
      await PluggyTransaction.updateOne(
        { pluggyId: tx.id, ignoreOverridden: existing.ignoreOverridden },
        Object.keys($unset).length ? { $set, $unset } : { $set }
      );
    }
    return staging.status === 'anomaly' ? 'anomaly' : 'updated';
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

  // Read inside the function, never at module scope — see client.ts. Anything
  // that is not an explicitly configured, finite, positive number falls back
  // to the default: an unset OR EMPTY value must not disable the overlap the
  // late-posting guarantee rests on (`Number('')` is 0, not NaN, so trimming
  // and testing for emptiness has to come first), and a non-numeric one would
  // otherwise reach computeSyncWindow as NaN and surface much later as an
  // opaque RangeError from `new Date(NaN).toISOString()`.
  const rawOverlap = (process.env.PLUGGY_SYNC_OVERLAP_DAYS ?? '').trim();
  const configuredOverlap = rawOverlap === '' ? NaN : Number(rawOverlap);
  const overlapDays =
    Number.isFinite(configuredOverlap) && configuredOverlap > 0
      ? configuredOverlap
      : DEFAULT_OVERLAP_DAYS;
  const { from, to } = computeSyncWindow(account, overlapDays);

  // Every currently-linked account, for the own-transfer ignore rule — a
  // counterparty leg is "our own" even if that account is disabled.
  const linkedAccountIds = new Set(
    (await PluggyAccount.find({}).select('accountId').lean<{ accountId: string }[]>()).map(a => a.accountId)
  );

  const result: SyncAccountResult = { accountId, fetched: 0, created: 0, updated: 0, anomalies: 0 };

  const { truncated } = await drainCursor(
    after => listTransactions({ accountId, from, to, after }),
    async rows => {
      result.fetched += rows.length;

      // dryRun still classifies each row (a DB read) so the report reflects
      // what would happen, but upsertTransaction writes nothing when dryRun is
      // set — the same contract a migration's dry run has.
      for (const tx of rows) {
        const outcome = await upsertTransaction(tx, account, linkedAccountIds, { dryRun });
        if (outcome === 'created') result.created++;
        else if (outcome === 'updated') result.updated++;
        else if (outcome === 'anomaly') result.anomalies++;
      }
    },
    MAX_SYNC_PAGES
  );

  // Hitting the page cap means Pluggy still had a cursor: the account was NOT
  // fully read. Falling through to the lastSyncedAt write below would move the
  // high-water mark past rows that were never fetched, and since the next
  // window starts at lastSyncedAt − OVERLAP_DAYS, anything older than that
  // overlap becomes unreachable forever — silent, permanent loss with a
  // healthy-looking `fetched`. Throw instead: the caller records the account's
  // error and the next run retries the same window.
  if (truncated) {
    throw new ApiError(
      'UPSTREAM_FAILED',
      `Sincronização truncada: a conta ${accountId} ainda tinha páginas após o limite de ` +
        `${MAX_SYNC_PAGES}. lastSyncedAt não foi avançado para não pular transações.`
    );
  }

  // Conditional on the connectedAt this window was computed from: moving the
  // start date earlier unsets lastSyncedAt (updateAccountLink) so the next run
  // backfills from it, and an unconditional write here would re-set the mark
  // and silently cancel that backfill if the edit landed mid-sync. Matching
  // zero rows is the correct outcome — the next run recomputes the window.
  if (!dryRun) {
    await PluggyAccount.updateOne(
      { accountId, connectedAt: account.connectedAt },
      { $set: { lastSyncedAt: new Date() } }
    );
  }

  return result;
}

// The review screen's one-click "não ignorar": only a currently-ignored row
// can move back to pending — imported/anomaly/skipped_existing status is not a
// toggle a human flips from the review screen. Sets `ignoreOverridden` so the
// next resync's re-derive (upsertTransaction) does not silently re-ignore the
// row — the ignore signal is the description/counterparty, which never
// changes, so without the flag this override would be reverted on the next
// sync tick.
export async function unignoreTransaction(pluggyId: string) {
  await connectToDatabase();

  return PluggyTransaction.findOneAndUpdate(
    { pluggyId, status: 'ignored' },
    { $set: { status: 'pending', ignoreOverridden: true }, $unset: { statusReason: '' } },
    { new: true }
  );
}

export interface ListPluggyTransactionsFilter {
  status?: string;
  accountId?: string;
  limit?: number;
  cursor?: string;
}

export interface ListPluggyTransactionsResult {
  items: unknown[];
  nextCursor: string | null;
}

// Keyset pagination on `date`, mirroring listExpenses in expenseService.ts —
// not skip/limit, so a review-screen page walk is stable under concurrent
// syncs. The cursor is the last returned _id.
export async function listPluggyTransactions(
  filter: ListPluggyTransactionsFilter = {}
): Promise<ListPluggyTransactionsResult> {
  await connectToDatabase();

  const limit = filter.limit ?? 100;
  const query: Record<string, unknown> = {};
  if (filter.status) query.status = filter.status;
  if (filter.accountId) query.accountId = filter.accountId;

  if (filter.cursor) {
    const anchor = await PluggyTransaction.findById(filter.cursor)
      .select('date')
      .lean<{ date: string } | null>();
    // A cursor pointing at a deleted row yields no page rather than silently
    // restarting from the top.
    if (!anchor) return { items: [], nextCursor: null };
    query.$or = [{ date: { $lt: anchor.date } }, { date: anchor.date, _id: { $lt: filter.cursor } }];
  }

  // One extra row is fetched to tell "page is full" from "there is more".
  const docs = await PluggyTransaction.find(query)
    .sort({ date: -1, _id: -1 })
    .limit(limit + 1)
    .lean();

  const hasMore = docs.length > limit;
  const items = hasMore ? docs.slice(0, limit) : docs;

  return {
    items,
    nextCursor: hasMore ? String((items[items.length - 1] as { _id: unknown })._id) : null,
  };
}

const LOCK_ID = 'singleton';
// Long enough to cover a full run across every enabled account, short enough
// that a crashed run does not block the next cron tick indefinitely.
//
// The ceiling this is sized against grew with the move to /v2/transactions:
// v2 fixes the page at 500 rows (the old page-based call used 100), so
// MAX_SYNC_PAGES now bounds an account at 25k rows rather than 5k, and each
// row costs a sequential findOne + write in upsertTransaction, with
// autoImportStaged running inside the same hold. A run that outlives this TTL
// lets the next tick acquire the lock and drain the same pending rows
// concurrently — the double-import the lock exists to prevent — so the TTL is
// raised in step with the ceiling rather than left at the value the 100-row
// page implied.
const LOCK_STALE_MS = 45 * 60 * 1000;

// Mongo signals a unique-index violation with code 11000 — the migration
// ledger (migrationService.ts) uses the same check for the same reason.
function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: number }).code === 11000;
}

// Acquires the singleton lock document, taking over a stale one by timestamp.
// The insert-vs-duplicate-key outcome *is* the answer to "did I get it" — see
// migrationService.ts's ledger claim for the same pattern.
async function tryAcquireLock(): Promise<boolean> {
  const threshold = new Date(Date.now() - LOCK_STALE_MS);
  try {
    await PluggySyncLock.findOneAndUpdate(
      { _id: LOCK_ID, acquiredAt: { $lt: threshold } },
      { $set: { acquiredAt: new Date() } },
      { upsert: true }
    );
    return true;
  } catch (error) {
    if (isDuplicateKeyError(error)) return false;
    throw error;
  }
}

// Explicit release rather than waiting out the staleness threshold: this run
// just stamped the lock with `now`, so no concurrent acquire could have slipped
// in while it worked, and releasing lets the next legitimate run proceed right
// away instead of blocking for LOCK_STALE_MS.
async function releaseLock(): Promise<void> {
  await PluggySyncLock.deleteOne({ _id: LOCK_ID });
}

// Acquires the lock, runs `fn`, and always releases — returning null (rather
// than calling `fn` at all) when another run already holds it. The lock now
// covers fetch AND import: the cron and "sincronizar agora" both end with
// autoImportStaged, and if that ran outside the lock two overlapping triggers
// could import the same staged row twice — the double-count this integration
// exists to prevent, just moved one phase later.
async function withSyncLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const acquired = await tryAcquireLock();
  if (!acquired) return null;

  try {
    return await fn();
  } finally {
    await releaseLock();
  }
}

export interface SyncAllAccountResult extends SyncAccountResult {
  error?: string;
}

export interface SyncAllResult {
  accounts: SyncAllAccountResult[];
  items: { itemId: string; status: string }[];
}

// Lock-free: refreshes every item's status, then syncs every enabled account —
// continuing past a single failing account (collecting its error) so one
// LOGIN_ERROR bank does not stop the others. Must only be called from inside
// withSyncLock (via runPluggySync).
async function syncAllAccounts({ dryRun = false }: { dryRun?: boolean } = {}): Promise<SyncAllResult> {
  const items = await PluggyItem.find({}).select('itemId').lean<{ itemId: string }[]>();
  const itemResults: { itemId: string; status: string }[] = [];
  for (const { itemId } of items) {
    try {
      const { status } = await refreshItemStatus(itemId);
      itemResults.push({ itemId, status });
    } catch (error) {
      itemResults.push({
        itemId,
        status: `REFRESH_FAILED: ${error instanceof Error ? error.message : String(error)}`,
      });
    }
  }

  const accounts = await PluggyAccount.find({ enabled: true }).select('accountId').lean<{ accountId: string }[]>();
  const accountResults: SyncAllAccountResult[] = [];
  for (const { accountId } of accounts) {
    try {
      accountResults.push(await syncAccount(accountId, { dryRun }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Collected per account so one failing bank cannot stop the others — but
      // LOG it too. This error travels back inside a 200 body, which is how a
      // Pluggy endpoint deprecation (410 on every account) went unnoticed in
      // production: the cron saw HTTP 200 and the review screen only renders an
      // error for a non-OK response, so a total outage read as a clean sync.
      console.error(`[pluggy] sync falhou para a conta ${accountId}: ${message}`);
      accountResults.push({
        accountId,
        fetched: 0,
        created: 0,
        updated: 0,
        anomalies: 0,
        error: message,
      });
    }
  }

  return { accounts: accountResults, items: itemResults };
}

export interface RunPluggySyncInput {
  dryRun?: boolean;
  accountId?: string;
  // PATCH /items/:id forces Pluggy to refresh an item outside its normal
  // update cadence — only the human-triggered "sincronizar agora" path wants
  // this; the 6h cron just re-reads what Pluggy already has. Best-effort per
  // item: a refresh failure must not block the read that follows.
  forceRefresh?: boolean;
}

export interface RunPluggySyncResult {
  sync: SyncAllResult | SyncAccountResult;
  autoImport?: AutoImportResult;
  // Present unless dryRun, and null-shaped (absent) when the pass itself
  // failed — a failed GPT call must not read as a failed sync; fetch and
  // auto-import already succeeded by then.
  suggestions?: SuggestStagedResult;
}

// The single entry point both sync routes call. Acquires the advisory lock
// ONCE around the whole pipeline — refresh (if forced), fetch, then import —
// so the cron and "sincronizar agora" can never run autoImportStaged over the
// same pending rows concurrently. Returns null when another run already holds
// the lock.
export async function runPluggySync({
  dryRun = false,
  accountId,
  forceRefresh = false,
}: RunPluggySyncInput = {}): Promise<RunPluggySyncResult | null> {
  await connectToDatabase();

  return withSyncLock(async () => {
    if (forceRefresh) {
      const items = await PluggyItem.find({}).select('itemId').lean<{ itemId: string }[]>();
      await Promise.all(items.map(({ itemId }) => patchItem(itemId).catch(() => undefined)));
    }

    const sync = accountId ? await syncAccount(accountId, { dryRun }) : await syncAllAccounts({ dryRun });
    const autoImport = dryRun ? undefined : await autoImportStaged();
    const suggestions = dryRun ? undefined : await suggestStagedCategories().catch(error => {
      // The suggestion pass is an enhancement layered on a completed sync:
      // fetch and auto-import already succeeded, and a failing GPT call or a
      // malformed model answer must not turn a healthy run into an error the
      // review screen renders as a failed sync. Log it server-side — the
      // same rule syncAllAccounts applies to a per-account failure — and
      // let the counts report what actually happened.
      console.error(`[pluggy] passada de sugestão falhou: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });

    return {
      sync,
      ...(autoImport && { autoImport }),
      ...(suggestions && { suggestions }),
    };
  });
}

export interface AutoImportResult {
  expensesImported: number;
  incomesImported: number;
  stillPending: number;
  skippedExisting: number;
}

// The skipped_existing check, within Pluggy only — reuses billService's guard
// (billService.ts ~227-236) exactly as written: an exact match on { name,
// value, date, cardBrand, installment, totalInstallments }, applied only to
// expanded installment rows. It works here because both sides of the
// comparison are produced by buildExpenseDocuments from the same anchor date,
// which is only true once the anchor-date correction above is in place. A
// single non-installment charge appearing twice is two charges, not a dupe —
// so non-installment documents are never deduped.
async function insertExpenseDocuments(
  documents: ExpenseDocument[],
  isInstallment: boolean
): Promise<{ importedIds: string[]; skippedExisting: number }> {
  const importedIds: string[] = [];
  let skippedExisting = 0;

  for (const document of documents) {
    if (isInstallment) {
      const exists = await Expense.findOne({
        name: document.name,
        value: document.value,
        date: document.date,
        cardBrand: document.cardBrand,
        installment: document.installment,
        totalInstallments: document.totalInstallments,
      });
      if (exists) {
        skippedExisting++;
        continue;
      }
    }
    const created = await Expense.create(document);
    importedIds.push(String(created._id));
  }

  return { importedIds, skippedExisting };
}

// Over status: 'pending' outflows whose pluggyStatus is POSTED — a PENDING
// row can still change amount or disappear entirely, and a row that
// disappears is never re-fetched, so it must never be auto-imported.
async function autoImportExpenses(result: AutoImportResult): Promise<void> {
  // enabled: false means "fetched into staging but never imported" — a row
  // staged while its account was still enabled must stop being auto-imported
  // the moment the account is disabled, so this is a query filter, not just a
  // gate on new rows.
  const enabledAccountIds = (
    await PluggyAccount.find({ enabled: true }).select('accountId').lean<{ accountId: string }[]>()
  ).map(a => a.accountId);
  if (enabledAccountIds.length === 0) return;

  const rows = await PluggyTransaction.find({
    status: 'pending',
    direction: 'outflow',
    pluggyStatus: 'POSTED',
    accountId: { $in: enabledAccountIds },
  });

  for (const row of rows) {
    const mapping = await BillMapping.findOne({ description: billMappingKey(row.description) });
    if (!mapping) {
      result.stillPending++;
      continue;
    }

    const valid = await validateExpensePair(mapping.type, mapping.subtype ?? undefined);
    if (!valid) {
      // A mapping pointing at a renamed-away category must surface in
      // review, never import against an orphaned type/subtype.
      row.suggestedType = mapping.type;
      if (mapping.subtype) row.suggestedSubtype = mapping.subtype;
      await row.save();
      result.stillPending++;
      continue;
    }

    // A row whose series cannot be anchored stays pending rather than being
    // expanded from an unknown offset.
    const resolved = resolveInstallmentPlan(row);
    if ('reason' in resolved) {
      row.statusReason = resolved.reason;
      await row.save();
      result.stillPending++;
      continue;
    }
    const { plan } = resolved;

    const documents = await buildExpenseDocuments({
      name: row.description,
      value: Math.abs(row.amount),
      type: mapping.type,
      subtype: mapping.subtype ?? undefined,
      paymentType: row.paymentType ?? 'debit',
      cardBrand: row.cardBrand ?? undefined,
      date: plan.date,
      installments: plan.installments,
      valueIsTotal: false,
    });

    const { importedIds, skippedExisting } = await insertExpenseDocuments(documents, plan.isGroup);
    result.skippedExisting += skippedExisting;

    if (importedIds.length > 0) {
      row.status = 'imported';
      row.importedExpenseIds = importedIds;
      result.expensesImported++;
    } else {
      // Every expanded installment already existed — this row is a re-post
      // of a purchase whose group another Pluggy row already imported.
      row.status = 'skipped_existing';
    }
    await row.save();
  }
}

// Over status: 'pending' inflows on BANK accounts: account.defaultIncomeType
// set and validateIncomeType passing creates the Income and marks imported;
// otherwise the row stays pending for review. There is deliberately no income
// mapping table — inflows are low-volume and repetitive, and a per-account
// default covers the recurring case (salary), leaving everything else as a
// couple of manual clicks a month. Same POSTED-only rule as expenses: a
// PENDING row can still vanish and must never be auto-imported.
async function autoImportIncomes(result: AutoImportResult): Promise<void> {
  // Same enabled-only rule as autoImportExpenses: a disabled account's pending
  // rows must sit in staging, not import.
  const accounts = await PluggyAccount.find({ kind: 'BANK', enabled: true }).lean<
    { accountId: string; defaultIncomeType?: string | null }[]
  >();
  const accountsById = new Map(accounts.map(a => [a.accountId, a]));

  const rows = await PluggyTransaction.find({ status: 'pending', direction: 'inflow', pluggyStatus: 'POSTED' });

  for (const row of rows) {
    const account = accountsById.get(row.accountId);
    if (!account || !account.defaultIncomeType) {
      result.stillPending++;
      continue;
    }

    const valid = await validateIncomeType(account.defaultIncomeType);
    if (!valid) {
      result.stillPending++;
      continue;
    }

    const income = await createIncome({
      name: row.description,
      value: Math.abs(row.amount),
      type: account.defaultIncomeType,
      date: row.date,
    });

    row.status = 'imported';
    row.importedIncomeId = String(income._id);
    await row.save();
    result.incomesImported++;
  }
}

export async function autoImportStaged(): Promise<AutoImportResult> {
  await connectToDatabase();

  const result: AutoImportResult = {
    expensesImported: 0,
    incomesImported: 0,
    stillPending: 0,
    skippedExisting: 0,
  };

  await autoImportExpenses(result);
  await autoImportIncomes(result);

  return result;
}

// --- the suggestion pass: the receipt import's intelligence, for staging ---

export interface SuggestStagedResult {
  expensesSuggested: number;
  incomesSuggested: number;
  historyHits: number;
  aiCalls: number;
  aiAnswers: number;
  unclassified: number;
}

interface PendingSuggestionRow {
  _id: unknown;
  pluggyId: string;
  direction: 'outflow' | 'inflow';
  description: string;
  suggestedType?: string;
  suggestedSubtype?: string;
  suggestionAttemptedAt?: Date;
}

// One GPT call per (direction, chunk) classifying the descriptions the
// history lookup missed, mirroring the receipt import's gpt-4o-mini call
// (the same model the app already ships, the same json_object response
// format). Chunked rather than one call per direction: a first sync after
// enabling an account can stage months of distinct merchants, and one
// request listing hundreds of them is a timeout and a truncated answer.
// The category list is read inside the function: it is a runtime database
// question, and freezing it anywhere else would store stale suggestions.
async function classifyWithModel(
  descriptions: string[],
  categories: { name: string; subtypes: string[] }[],
  direction: 'expense' | 'income'
): Promise<Record<string, unknown>> {
  const categoryList = categories
    .map(c => (c.subtypes.length > 0 ? `${c.name} (${c.subtypes.join(', ')})` : c.name))
    .join('; ');
  const subtypesGuidance =
    direction === 'expense'
      ? 'Gastos têm subcategorias: informe "subtype" quando conseguir escolher uma; se não conseguir, omita "subtype".'
      : 'Receitas não têm subcategoria: nunca informe "subtype" em uma receita.';

  const completion = await getOpenAI().chat.completions.create({
    model: 'gpt-4o-mini',
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: `Você classifica transações bancárias brasileiras para um app de finanças pessoais.
Retorne APENAS um JSON: { "DESCRIÇÃO": { "type": "categoria", "subtype": "subcategoria" } }, com um objeto para cada descrição enviada.

As categorias${direction === 'expense' ? ' e subcategorias' : ''} válidas de ${direction === 'expense' ? 'gasto' : 'receita'} são EXATAMENTE estas:
${categoryList}

${subtypesGuidance}
Se não conseguir classificar uma descrição com segurança, omita-a do objeto de resposta.`,
      },
      {
        role: 'user',
        content: JSON.stringify(descriptions),
      },
    ],
  });

  return JSON.parse(completion.choices[0].message.content ?? '{}');
}

// How many descriptions go into one classifyWithModel call.
const SUGGESTION_CHUNK_SIZE = 50;

// Case/accent-insensitive folding for matching the model's echoed keys — the
// same fold categoryUtils uses to resolve caller-supplied names. The model is
// asked to return each description as a JSON key, and LLMs routinely "clean
// up" what they echo (trim, lowercase, drop an accent); matching folded keys
// recovers those answers while still only ever trusting a key that folds to a
// description we actually sent.
const foldDescription = (s: string) =>
  s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

async function classifyAllWithModel(
  descriptions: string[],
  categories: { name: string; subtypes: string[] }[],
  direction: 'expense' | 'income'
): Promise<{ answers: Record<string, unknown>; calls: number; attempted: Set<string> }> {
  const answers: Record<string, unknown> = {};
  const attempted = new Set<string>();
  let calls = 0;

  for (let i = 0; i < descriptions.length; i += SUGGESTION_CHUNK_SIZE) {
    const chunk = descriptions.slice(i, i + SUGGESTION_CHUNK_SIZE);
    let raw: Record<string, unknown>;
    try {
      raw = await classifyWithModel(chunk, categories, direction);
    } catch (error) {
      // One chunk failing (timeout, malformed JSON, empty choices) must not
      // sink the rest of the pass — nor the other direction, nor the history
      // suggestions the caller writes alongside. Its descriptions stay
      // unattempted, so the next sync retries them instead of permanently
      // marking an unclassifiable merchant the model never actually saw.
      console.error(
        `[pluggy] chunk de sugestão (${direction}) falhou: ${error instanceof Error ? error.message : String(error)}`
      );
      continue;
    }
    calls++;
    for (const description of chunk) attempted.add(description);
    // A model answer keyed by something other than one of the descriptions
    // sent is dropped here rather than trusted — validSuggestionAnswers
    // filters the values, but the keys are trusted only because they fold to
    // a description we actually staged.
    const byFolded = new Map(chunk.map(d => [foldDescription(d), d]));
    for (const key of Object.keys(raw)) {
      const original = byFolded.get(foldDescription(key));
      if (original !== undefined) answers[original] = raw[key];
    }
  }

  return { answers, calls, attempted };
}

// The suggestion pass, run by runPluggySync after autoImportStaged, inside
// the same advisory-lock hold: every pending row still lacking a valid
// suggestion gets one, history first (the latest already-classified
// Expense/Income with the same description), then one batched GPT call per
// direction for what history missed — the same ladder the receipt import
// runs (ProductMapping → GPT), minus the receipt's store/product scoping,
// which bank descriptions do not have.
//
// A stored suggestion is a prefill for the review screen, nothing more: it
// never imports anything by itself, and importStaged re-validates the
// confirmed pair against the live Category list at import time. Only rows
// with no suggestion at all are touched (see below), so re-running it on
// every sync is idempotent.
export async function suggestStagedCategories(): Promise<SuggestStagedResult> {
  await connectToDatabase();

  const result: SuggestStagedResult = {
    expensesSuggested: 0,
    incomesSuggested: 0,
    historyHits: 0,
    aiCalls: 0,
    aiAnswers: 0,
    unclassified: 0,
  };

  const [expenseCategories, incomeCategories] = await Promise.all([
    getExpenseCategories(),
    getIncomeCategories(),
  ]);

  const rows = await PluggyTransaction.find(
    { status: 'pending' },
    'pluggyId direction description suggestedType suggestedSubtype suggestionAttemptedAt'
  ).lean<PendingSuggestionRow[]>();

  // Only rows with NO suggestion at all are eligible. A row that already
  // carries one — a prior pass's answer that is still valid, or the
  // orphaned-pair hint autoImportStaged writes when a BillMapping points at
  // a renamed-away category — keeps it: overwriting the hint would hide
  // what the mapping said, which is the exact context the review screen
  // shows so the human can fix the mapping itself on confirm (see the
  // Bruno "dead category stays unimported" request). The suggestion-pair
  // validity question is left to the confirm gate, which re-validates
  // against the live Category list — the same place importStaged checks it.
  const needsSuggestion = rows.filter(row => row.suggestedType == null);

  if (needsSuggestion.length === 0) return result;

  const { expenses: expenseDescriptions, incomes: incomeDescriptions } =
    suggestionBatch(needsSuggestion);

  // --- history: the latest already-classified record with the same description
  // History goes through validSuggestionAnswers like the model's answers: a
  // past expense can carry a subtype that was since renamed away (the
  // cascade fixes it, but `force` deletes leave orphans), and storing that
  // pair would prefill a select the confirm gate then blanks.
  //
  // One query per direction, not one per description: `name` is unindexed,
  // so N sequential findOne calls would be N collection scans inside the
  // sync lock. Sorted newest first, the first document seen per name wins.
  const latestByName = (docs: { name: string; type: string; subtype?: string }[]) => {
    const latest: Record<string, unknown> = {};
    for (const doc of docs) {
      if (!(doc.name in latest)) latest[doc.name] = { type: doc.type, subtype: doc.subtype };
    }
    return latest;
  };

  const expenseDocs = expenseDescriptions.length
    ? await Expense.find(
        { name: { $in: expenseDescriptions }, type: { $in: expenseCategories.map(c => c.name) } },
        'name type subtype'
      )
        .sort({ date: -1, _id: -1 })
        .lean<{ name: string; type: string; subtype?: string }[]>()
    : [];
  const expenseHistory = new Map(
    Object.entries(validSuggestionAnswers(latestByName(expenseDocs), expenseCategories))
  );

  const incomeDocs = incomeDescriptions.length
    ? await Income.find(
        { name: { $in: incomeDescriptions }, type: { $in: incomeCategories.map(c => c.name) } },
        'name type'
      )
        .sort({ date: -1, _id: -1 })
        .lean<{ name: string; type: string }[]>()
    : [];
  const incomeHistory = new Map(
    Object.entries(validSuggestionAnswers(latestByName(incomeDocs), incomeCategories))
  );

  result.historyHits = expenseHistory.size + incomeHistory.size;

  // --- AI: batched calls per direction, only for what history missed and
  // the model has not already failed on (suggestionAttemptedAt). A
  // description is sent when at least one of its rows is still unattempted.
  const unattempted = (direction: 'outflow' | 'inflow') =>
    new Set(
      needsSuggestion
        .filter(row => row.direction === direction && row.suggestionAttemptedAt == null)
        .map(row => row.description)
    );
  const unattemptedExpenses = unattempted('outflow');
  const unattemptedIncomes = unattempted('inflow');
  const aiExpenseDescriptions = expenseDescriptions.filter(
    d => !expenseHistory.has(d) && unattemptedExpenses.has(d)
  );
  const aiIncomeDescriptions = incomeDescriptions.filter(
    d => !incomeHistory.has(d) && unattemptedIncomes.has(d)
  );

  const expenseClassification =
    aiExpenseDescriptions.length > 0
      ? await classifyAllWithModel(aiExpenseDescriptions, expenseCategories, 'expense')
      : { answers: {} as Record<string, unknown>, calls: 0, attempted: new Set<string>() };
  const incomeClassification =
    aiIncomeDescriptions.length > 0
      ? await classifyAllWithModel(aiIncomeDescriptions, incomeCategories, 'income')
      : { answers: {} as Record<string, unknown>, calls: 0, attempted: new Set<string>() };

  const aiExpenses = validSuggestionAnswers(expenseClassification.answers, expenseCategories);
  const aiIncomes = validSuggestionAnswers(incomeClassification.answers, incomeCategories);

  result.aiCalls = expenseClassification.calls + incomeClassification.calls;
  result.aiAnswers = Object.keys(aiExpenses).length + Object.keys(aiIncomes).length;
  // Descriptions the model actually saw but answered with nothing usable —
  // omitted as uncertain, or naming a category that does not exist. Counted
  // from `attempted` (not the full send list) so a failed chunk, whose rows
  // were never really classified, is not reported as "unclassifiable".
  result.unclassified =
    expenseClassification.attempted.size +
    incomeClassification.attempted.size -
    result.aiAnswers;

  // --- write: history beats AI per description, onto the rows still lacking one
  // Typed from the model's own bulkWrite signature rather than an imported
  // generic — the raw schema doc shape it needs is inferred, not nameable.
  const bulkOps: Parameters<typeof PluggyTransaction.bulkWrite>[0] = [];
  const attemptedAt = new Date();
  const markAttempted = (row: PendingSuggestionRow) =>
    bulkOps.push({
      updateOne: {
        filter: { _id: row._id, status: 'pending' },
        update: { $set: { suggestionAttemptedAt: attemptedAt } },
      },
    });
  for (const row of needsSuggestion) {
    if (row.direction === 'outflow') {
      const historyAnswer = expenseHistory.get(row.description);
      const aiAnswer = aiExpenses[row.description];
      const answer = historyAnswer ?? aiAnswer;
      if (!answer) {
        if (expenseClassification.attempted.has(row.description)) markAttempted(row);
        continue;
      }
      const by: SuggestionSource = historyAnswer ? 'history' : 'ai';
      bulkOps.push({
        updateOne: {
          filter: { _id: row._id, status: 'pending' },
          update: {
            $set: {
              suggestedType: answer.type,
              ...(answer.subtype !== undefined && { suggestedSubtype: answer.subtype }),
              suggestedBy: by,
            },
          },
        },
      });
      result.expensesSuggested++;
    } else {
      const historyAnswer = incomeHistory.get(row.description);
      const aiAnswer = aiIncomes[row.description];
      const answer = historyAnswer ?? aiAnswer;
      if (!answer) {
        if (incomeClassification.attempted.has(row.description)) markAttempted(row);
        continue;
      }
      const by: SuggestionSource = historyAnswer ? 'history' : 'ai';
      bulkOps.push({
        updateOne: {
          filter: { _id: row._id, status: 'pending' },
          update: {
            $set: {
              suggestedType: answer.type,
              suggestedBy: by,
            },
          },
        },
      });
      result.incomesSuggested++;
    }
  }

  if (bulkOps.length > 0) {
    await PluggyTransaction.bulkWrite(bulkOps);
  }

  return result;
}

// The manual path from the review screen: explicit rows a human classified,
// rather than a BillMapping hit or an account default.
export interface ImportStagedItem {
  pluggyId: string;
  kind: 'expense' | 'income';
  type: string;
  subtype?: string;
  paymentType?: string;
  cardBrand?: string;
  // Upserts a BillMapping (expense rows only) so the next occurrence of this
  // merchant auto-imports — the same envelope shape and the same rule that
  // only skippedInvalid is actionable as the bill import.
  newMapping?: boolean;
}

export interface ImportStagedResult {
  imported: number;
  skippedInvalid: number;
  skippedExisting: number;
}

async function importStagedExpense(
  row: InstanceType<typeof PluggyTransaction>,
  item: ImportStagedItem,
  result: ImportStagedResult
): Promise<void> {
  const valid = await validateExpensePair(item.type, item.subtype);
  if (!valid) {
    result.skippedInvalid++;
    return;
  }

  const resolved = resolveInstallmentPlan(row);
  if ('reason' in resolved) {
    result.skippedInvalid++;
    return;
  }
  const { plan } = resolved;

  const paymentType = item.paymentType ?? row.paymentType ?? 'debit';
  const cardBrand = item.cardBrand ?? row.cardBrand ?? undefined;

  const documents = await buildExpenseDocuments({
    name: row.description,
    value: Math.abs(row.amount),
    type: item.type,
    subtype: item.subtype,
    paymentType,
    cardBrand,
    date: plan.date,
    installments: plan.installments,
    valueIsTotal: false,
  });

  const { importedIds, skippedExisting } = await insertExpenseDocuments(documents, plan.isGroup);
  result.skippedExisting += skippedExisting;

  if (importedIds.length > 0) {
    row.status = 'imported';
    row.importedExpenseIds = importedIds;
    result.imported++;
  } else {
    row.status = 'skipped_existing';
  }
  await row.save();

  if (item.newMapping) {
    // A reclassification to a type with no subtype must CLEAR the stored one,
    // not leave it. Mongoose drops `undefined` keys from an update, so
    // `$set: { subtype: undefined }` is a silent no-op that keeps a stale
    // subtype alive — and the next sync's autoImportStaged reads that mapping,
    // finds the stale pair still valid, and auto-imports under the very
    // subtype the reviewer just removed, with no human in the loop.
    // billService avoids this by making its wire type `.nullable()`; here the
    // field is `.optional()`, so the clear has to be an explicit $unset.
    await BillMapping.updateOne(
      { description: billMappingKey(row.description) },
      item.subtype !== undefined
        ? { $set: { type: item.type, subtype: item.subtype } }
        : { $set: { type: item.type }, $unset: { subtype: '' } },
      { upsert: true }
    );
  }
}

async function importStagedIncome(
  row: InstanceType<typeof PluggyTransaction>,
  item: ImportStagedItem,
  result: ImportStagedResult
): Promise<void> {
  const valid = await validateIncomeType(item.type);
  if (!valid) {
    result.skippedInvalid++;
    return;
  }

  const income = await createIncome({
    name: row.description,
    value: Math.abs(row.amount),
    type: item.type,
    date: row.date,
  });

  row.status = 'imported';
  row.importedIncomeId = String(income._id);
  await row.save();
  result.imported++;
}

export async function importStaged(items: ImportStagedItem[]): Promise<ImportStagedResult> {
  await connectToDatabase();

  const result: ImportStagedResult = { imported: 0, skippedInvalid: 0, skippedExisting: 0 };

  for (const item of items) {
    const row = await PluggyTransaction.findOne({ pluggyId: item.pluggyId });
    if (!row) {
      result.skippedInvalid++;
      continue;
    }

    if (item.kind === 'expense') {
      await importStagedExpense(row, item, result);
    } else {
      await importStagedIncome(row, item, result);
    }
  }

  return result;
}
