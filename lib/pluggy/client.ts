import { ApiError } from '../api/respond';

const PLUGGY_API_BASE = 'https://api.pluggy.ai';

// Pluggy's key is valid for ~2h; refreshed early so no in-flight call can start
// with a key that expires mid-request.
const KEY_TTL_MS = 2 * 60 * 60 * 1000;
const SAFETY_MARGIN_MS = 5 * 60 * 1000;

const RETRY_DELAYS_MS = [500, 1500];

interface PluggyAuthCache {
  apiKey: string;
  expiresAt: number;
}

// Global-cache singleton, same shape as lib/openai.ts — survives Next.js's
// dev-mode module reloads instead of re-authenticating on every hot reload.
const globalForPluggy = globalThis as unknown as {
  pluggyAuth?: PluggyAuthCache;
  pluggyAuthInflight?: Promise<string>;
};

async function extractErrorMessage(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string; error?: string } | null;
    return data?.message ?? data?.error ?? response.statusText;
  } catch {
    return response.statusText;
  }
}

async function requestApiKey(): Promise<string> {
  // Read inside the function, never at module scope: the CI lint/build jobs
  // run with no secrets, and a module-scope read would make the build depend
  // on one (the same rule as requireApiKey and connectToDatabase).
  const clientId = process.env.PLUGGY_CLIENT_ID;
  const clientSecret = process.env.PLUGGY_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new ApiError(
      'UPSTREAM_FAILED',
      'PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET não configurados.'
    );
  }

  const response = await fetch(`${PLUGGY_API_BASE}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });

  if (!response.ok) {
    throw new ApiError('UPSTREAM_FAILED', `Pluggy auth falhou: ${await extractErrorMessage(response)}`);
  }

  const data = (await response.json()) as { apiKey: string };
  return data.apiKey;
}

// Single-flight: concurrent callers during a cold cache share the same
// in-flight /auth request instead of each minting their own key.
async function getApiKey(): Promise<string> {
  const cached = globalForPluggy.pluggyAuth;
  if (cached && cached.expiresAt - SAFETY_MARGIN_MS > Date.now()) {
    return cached.apiKey;
  }

  if (!globalForPluggy.pluggyAuthInflight) {
    globalForPluggy.pluggyAuthInflight = requestApiKey()
      .then(apiKey => {
        globalForPluggy.pluggyAuth = { apiKey, expiresAt: Date.now() + KEY_TTL_MS };
        return apiKey;
      })
      .finally(() => {
        globalForPluggy.pluggyAuthInflight = undefined;
      });
  }

  return globalForPluggy.pluggyAuthInflight;
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function buildUrl(path: string, query?: Record<string, string | number | undefined>): string {
  const url = new URL(`${PLUGGY_API_BASE}${path}`);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

interface PluggyRequestOptions {
  method?: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
}

// A 5xx or a network error retries twice with backoff; a 4xx never retries —
// it means the request itself is wrong, and retrying it just repeats the
// failure against Pluggy's rate limits.
async function pluggyFetch<T>(path: string, options: PluggyRequestOptions = {}): Promise<T> {
  const apiKey = await getApiKey();
  const url = buildUrl(path, options.query);

  for (let attempt = 0; ; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        method: options.method ?? 'GET',
        headers: {
          'X-API-KEY': apiKey,
          ...(options.body !== undefined && { 'Content-Type': 'application/json' }),
        },
        ...(options.body !== undefined && { body: JSON.stringify(options.body) }),
      });
    } catch (error) {
      if (attempt < RETRY_DELAYS_MS.length) {
        await delay(RETRY_DELAYS_MS[attempt]);
        continue;
      }
      throw new ApiError(
        'UPSTREAM_FAILED',
        `Falha de rede ao chamar a Pluggy: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    if (response.ok) {
      if (response.status === 204) return undefined as T;
      return (await response.json()) as T;
    }

    if (response.status >= 500 && attempt < RETRY_DELAYS_MS.length) {
      await delay(RETRY_DELAYS_MS[attempt]);
      continue;
    }

    throw new ApiError(
      'UPSTREAM_FAILED',
      `Pluggy respondeu ${response.status}: ${await extractErrorMessage(response)}`
    );
  }
}

// ─── Typed shapes ───────────────────────────────────────────────────────────
// Field names are hypotheses from the plan's §0 research table, unverified
// against a live account (step 1 is out of scope without Pluggy credentials).
// Every raw-field read on these types is centralized in lib/utils/pluggyUtils.ts
// so a spike correction later touches one file.

export interface PluggyItemApi {
  id: string;
  connector: { id: number };
  status: string;
  statusDetail?: string | null;
  updatedAt?: string;
  [key: string]: unknown;
}

export interface PluggyAccountApi {
  id: string;
  itemId: string;
  type: string; // 'BANK' | 'CREDIT'
  name: string;
  marketingName?: string | null;
  number?: string | null;
  [key: string]: unknown;
}

export interface PluggyAccountsResponse {
  results: PluggyAccountApi[];
}

export interface PluggyTransactionApi {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  currencyCode?: string;
  merchant?: { name?: string | null } | null;
  category?: string | null;
  status?: string; // 'POSTED' | 'PENDING'
  type?: string; // 'DEBIT' | 'CREDIT'
  paymentData?: {
    paymentMethod?: string | null;
    payer?: { documentNumber?: string | null; accountId?: string | null } | null;
    receiver?: { documentNumber?: string | null; accountId?: string | null } | null;
  } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
  } | null;
  [key: string]: unknown;
}

// The cursor-based page shape of GET /v2/transactions. `next` is a full query
// string (`?accountId=…&after=…`) when another page exists, and null on the
// last page — there is no page/total/totalPages, and no way to know the total
// up front.
export interface PluggyTransactionsPage {
  results: PluggyTransactionApi[];
  next: string | null;
}

export interface ListTransactionsParams {
  accountId: string;
  from?: string;
  to?: string;
  // The URL-DECODED `after` value parsed out of the previous page's `next`,
  // never the whole `next` string. v2 rejects `pageSize` outright
  // ("property pageSize should not exist"); page size is fixed at 500.
  after?: string;
}

export interface PluggyConnectToken {
  accessToken: string;
}

export function getItem(itemId: string): Promise<PluggyItemApi> {
  return pluggyFetch(`/items/${itemId}`);
}

export function listAccounts(itemId: string): Promise<PluggyAccountsResponse> {
  return pluggyFetch('/accounts', { query: { itemId } });
}

// GET /v2/transactions — cursor pagination. The page-based /transactions was
// retired by Pluggy and now answers 410 ENDPOINT_DEPRECATED, which syncAccount
// swallowed per account, so every sync silently reported `fetched: 0`.
// `dateFrom`/`dateTo` are the v2 names for the old `from`/`to`.
export function listTransactions(params: ListTransactionsParams): Promise<PluggyTransactionsPage> {
  const { accountId, from, to, after } = params;
  return pluggyFetch('/v2/transactions', {
    query: { accountId, dateFrom: from, dateTo: to, after },
  });
}

// Pluggy returns `next` as a ready-made query string (`?accountId=…&after=…`).
// Re-sending it whole as a single `after` value 400s; the documented contract
// is to extract the URL-decoded `after` and pass only that. Returns undefined
// when there is no next page, or when `next` carries no `after` — treating an
// unparseable cursor as "no more pages" ends the loop instead of refetching
// page 1 forever.
export function parseAfterCursor(next: string | null | undefined): string | undefined {
  if (!next) return undefined;
  const queryStart = next.indexOf('?');
  const query = queryStart >= 0 ? next.slice(queryStart + 1) : next;
  // An empty `after` is not a cursor: returning '' would send `after=` on the
  // next request and make the loop refetch page 1.
  return new URLSearchParams(query).get('after') || undefined;
}

export interface CursorPage<T> {
  results: T[];
  next: string | null;
}

export interface CursorDrainResult {
  pages: number;
  // True when the page cap was reached while Pluggy was still handing back a
  // cursor — i.e. the list was NOT exhausted. The caller must treat this as a
  // failed read: advancing a high-water mark after a truncated drain makes the
  // unread rows unreachable on every future run.
  truncated: boolean;
}

// Walks a cursor-paginated Pluggy list, handing each page to `onPage` as it
// arrives (so the caller can stream rows instead of buffering an account's
// whole history). Injecting `fetchPage` keeps this testable without a database
// or a network, which is what lets the truncation case below be covered at all.
//
// Termination is `next === null` ONLY. A short page is not the end of the list
// under v2 — Pluggy may return fewer rows than the cap on a page that still has
// a successor — so the old `rows.length < PAGE_SIZE` test would silently drop
// every row after it.
export async function drainCursor<T>(
  fetchPage: (after: string | undefined) => Promise<CursorPage<T>>,
  onPage: (results: T[]) => Promise<void> | void,
  maxPages: number
): Promise<CursorDrainResult> {
  let after: string | undefined;

  for (let page = 1; page <= maxPages; page++) {
    const { results, next } = await fetchPage(after);
    await onPage(results);

    after = parseAfterCursor(next);
    if (!after) return { pages: page, truncated: false };
  }

  return { pages: maxPages, truncated: true };
}

export function createConnectToken(): Promise<PluggyConnectToken> {
  return pluggyFetch('/connect_token', { method: 'POST', body: {} });
}

// Forces Pluggy to refresh an item outside its normal update cadence — the
// "sincronizar agora" button, never the cron (see the plan's §5 risk note).
// Deliberately no createItem(connectorId, credentials): the item is created in
// the browser by Pluggy Connect so bank credentials never transit this app.
export function patchItem(itemId: string): Promise<PluggyItemApi> {
  return pluggyFetch(`/items/${itemId}`, { method: 'PATCH', body: {} });
}
