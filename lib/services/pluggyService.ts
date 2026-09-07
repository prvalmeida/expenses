import connectToDatabase from '../mongodb';
import Expense from '../models/Expense';
import Income from '../models/Income';
import { PluggyItem } from '../models/PluggyItem';
import { PluggyAccount } from '../models/PluggyAccount';
import { PluggyTransaction } from '../models/PluggyTransaction';
import { PluggySyncLock } from '../models/PluggySyncLock';
import { BillMapping } from '../models/BillMapping';
import { getItem, listAccounts, listTransactions, PluggyAccountApi, PluggyTransactionApi } from '../pluggy/client';
import {
  mapPluggyTransaction,
  deriveDirection,
  derivePaymentType,
  deriveInstallments,
  shouldIgnore,
  PluggyAccountLike,
} from '../utils/pluggyUtils';
import { billMappingKey } from '../utils/billUtils';
import { validateExpensePair, validateIncomeType } from '../utils/categoryUtils';
import { buildExpenseDocuments, ExpenseDocument } from './expenseService';
import { addMonthsClamped } from '../utils/dateUtils';
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
// then the double-counting guard.
function deriveStaging(
  tx: PluggyTransactionApi,
  account: PluggyAccountLike,
  linkedAccountIds: ReadonlySet<string>
): StagingDerivation {
  const { direction, anomalyReason } = deriveDirection(tx);
  if (!direction) {
    return { status: 'anomaly', statusReason: anomalyReason };
  }

  const { paymentType, cardBrand } = derivePaymentType(tx, account);
  const ignore = shouldIgnore(tx, account, direction, { linkedAccountIds });
  if (ignore.ignored) {
    return { direction, paymentType, cardBrand, status: 'ignored', statusReason: `${ignore.ruleId}: ${ignore.reason}` };
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
    .select('status amount date')
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
    const staging = deriveStaging(tx, account, linkedAccountIds);
    if (!dryRun) {
      const $set: Record<string, unknown> = { ...fields, ...stagingSetFields(staging), lastSeenAt: new Date() };
      const $unset: Record<string, ''> = {};
      if (staging.statusReason !== undefined) $set.statusReason = staging.statusReason;
      else $unset.statusReason = '';

      await PluggyTransaction.updateOne(
        { pluggyId: tx.id },
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

  // Read inside the function, never at module scope — see client.ts.
  const overlapDays = Number(process.env.PLUGGY_SYNC_OVERLAP_DAYS ?? DEFAULT_OVERLAP_DAYS);
  const { from, to } = computeSyncWindow(account, overlapDays);

  // Every currently-linked account, for the own-transfer ignore rule — a
  // counterparty leg is "our own" even if that account is disabled.
  const linkedAccountIds = new Set(
    (await PluggyAccount.find({}).select('accountId').lean<{ accountId: string }[]>()).map(a => a.accountId)
  );

  const result: SyncAccountResult = { accountId, fetched: 0, created: 0, updated: 0, anomalies: 0 };

  for (let page = 1; page <= MAX_SYNC_PAGES; page++) {
    const { results: rows } = await listTransactions({ accountId, from, to, page, pageSize: PAGE_SIZE });
    result.fetched += rows.length;

    // dryRun still classifies each row (a DB read) so the report reflects what
    // would happen, but upsertTransaction writes nothing when dryRun is set —
    // the same contract a migration's dry run has.
    for (const tx of rows) {
      const outcome = await upsertTransaction(tx, account, linkedAccountIds, { dryRun });
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

const LOCK_ID = 'singleton';
// Long enough to cover a full run across every enabled account (each capped at
// MAX_SYNC_PAGES pages); short enough that a crashed run does not block the
// next cron tick indefinitely.
const LOCK_STALE_MS = 15 * 60 * 1000;

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

export interface SyncAllAccountResult extends SyncAccountResult {
  error?: string;
}

export interface SyncAllResult {
  accounts: SyncAllAccountResult[];
  items: { itemId: string; status: string }[];
}

// The cron entry point. Refreshes every item's status first, then syncs every
// enabled account — continuing past a single failing account (collecting its
// error) so one LOGIN_ERROR bank does not stop the others. Returns null when
// another run already holds the lock, so two overlapping cron firings can
// never page the same account.
export async function syncAll({ dryRun = false }: { dryRun?: boolean } = {}): Promise<SyncAllResult | null> {
  await connectToDatabase();

  const acquired = await tryAcquireLock();
  if (!acquired) return null;

  try {
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
        accountResults.push({
          accountId,
          fetched: 0,
          created: 0,
          updated: 0,
          anomalies: 0,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return { accounts: accountResults, items: itemResults };
  } finally {
    await releaseLock();
  }
}

export interface AutoImportResult {
  expensesImported: number;
  incomesImported: number;
  stillPending: number;
  skippedExisting: number;
}

// A Pluggy row's date is the POSTING date of the one installment it
// represents, not the original purchase date — buildExpenseDocuments walks
// forward from `date` treating it as installment 1, so a mid-series row must
// be backed off by (installmentCurrent - 1) months before being passed in.
// addMonthsClamped handles the negative offset correctly.
function anchorPurchaseDate(row: { date: string }, installments?: { current: number }): string {
  if (!installments) return row.date;
  return addMonthsClamped(row.date, -(installments.current - 1)).toISOString().split('T')[0];
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
  const rows = await PluggyTransaction.find({ status: 'pending', direction: 'outflow', pluggyStatus: 'POSTED' });

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

    const installments = deriveInstallments({
      installmentCurrent: row.installmentCurrent ?? undefined,
      installmentTotal: row.installmentTotal ?? undefined,
    });
    // installmentCurrent is required to expand: a row that carries a total
    // but no plausible current stays pending rather than being expanded from
    // an unknown offset.
    if (row.installmentTotal && row.installmentTotal > 1 && !installments) {
      row.statusReason =
        'Parcela sem número de parcela atual plausível — não é possível ancorar a data de compra.';
      await row.save();
      result.stillPending++;
      continue;
    }

    const documents = await buildExpenseDocuments({
      name: row.description,
      value: Math.abs(row.amount),
      type: mapping.type,
      subtype: mapping.subtype ?? undefined,
      paymentType: row.paymentType ?? 'debit',
      cardBrand: row.cardBrand ?? undefined,
      date: anchorPurchaseDate(row, installments),
      installments: installments ? installments.total : 1,
      valueIsTotal: false,
    });

    const { importedIds, skippedExisting } = await insertExpenseDocuments(documents, !!installments);
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
  const accounts = await PluggyAccount.find({ kind: 'BANK' }).lean<
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

    const income = await Income.create({
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
