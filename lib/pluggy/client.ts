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
// Verified against a live Caixa connection (connector 200) on 2026-09-07 —
// what follows is the payload that account actually returns, not the plan's
// §0 research table. Every raw-field read on these types is still centralized
// in lib/utils/pluggyUtils.ts so the next correction touches one file.

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
  // Full ISO timestamp ("2026-08-14T03:00:00.000Z"), not a bare YYYY-MM-DD —
  // mapPluggyTransaction is what narrows it to a date.
  date: string;
  description: string;
  amount: number;
  currencyCode?: string;
  // Both name fields come back empty on some rows and absent on others; the
  // live payload carries `{ cnpj, name, businessName }` or `{ cnae, cnpj,
  // category, businessName }` depending on the merchant.
  merchant?: {
    name?: string | null;
    businessName?: string | null;
    [key: string]: unknown;
  } | null;
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
    // The original purchase date of an installment series, present on Caixa's
    // installment rows. This is what Expense.date means, so anchorPurchaseDate
    // prefers it over the month arithmetic whenever it is present; see the
    // note there.
    purchaseDate?: string | null;
    cardNumber?: string | null;
    billId?: string | null;
    billForecastDate?: string | null;
  } | null;
  [key: string]: unknown;
}

// GET /v2/transactions answers with a cursor envelope, not a page count:
// `next` is a ready-made query string ("?accountId=…&after=…") or null on the
// last page. `nextCursor` is that string's `after` value, extracted here so no
// caller has to parse a URL — the pagination shape stays inside this file.
export interface PluggyTransactionsPage {
  results: PluggyTransactionApi[];
  nextCursor?: string;
}

export interface ListTransactionsParams {
  accountId: string;
  from?: string;
  to?: string;
  after?: string;
}

interface PluggyCursorPageApi {
  results: PluggyTransactionApi[];
  next: string | null;
}

// `next` arrives as a query string rather than a bare token. Reading `after`
// out of it (instead of appending the string to the path) keeps buildUrl the
// single place a Pluggy URL is assembled, and means a new filter Pluggy starts
// echoing back cannot silently override the ones we sent.
function cursorFromNext(next: string | null): string | undefined {
  if (!next) return undefined;
  const query = next.includes('?') ? next.slice(next.indexOf('?') + 1) : next;
  return new URLSearchParams(query).get('after') ?? undefined;
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

// GET /transactions (page-numbered) is retired — it answers 410 "This endpoint
// is deprecated. Use GET /v2/transactions with cursor pagination instead", so
// every sync failed with UPSTREAM_FAILED and staged nothing. v2 renames the
// date filters (`dateFrom`/`dateTo`, not `from`/`to`) and rejects `pageSize`
// outright; its page size is fixed at 500.
export async function listTransactions(
  params: ListTransactionsParams
): Promise<PluggyTransactionsPage> {
  const { accountId, from, to, after } = params;
  const page = await pluggyFetch<PluggyCursorPageApi>('/v2/transactions', {
    query: { accountId, dateFrom: from, dateTo: to, after },
  });

  const nextCursor = cursorFromNext(page.next);
  return {
    results: page.results ?? [],
    ...(nextCursor && { nextCursor }),
  };
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
