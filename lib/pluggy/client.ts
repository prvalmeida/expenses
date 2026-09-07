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
    payer?: unknown;
    receiver?: unknown;
  } | null;
  creditCardMetadata?: {
    installmentNumber?: number | null;
    totalInstallments?: number | null;
  } | null;
  [key: string]: unknown;
}

export interface PluggyTransactionsPage {
  results: PluggyTransactionApi[];
  page: number;
  total: number;
  totalPages: number;
}

export interface ListTransactionsParams {
  accountId: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
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

export function listTransactions(params: ListTransactionsParams): Promise<PluggyTransactionsPage> {
  const { accountId, from, to, page, pageSize } = params;
  return pluggyFetch('/transactions', { query: { accountId, from, to, page, pageSize } });
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
