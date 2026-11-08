#!/usr/bin/env node
/**
 * Daily Telegram digest: runs a Pluggy sync, then prints (plain text, for the
 * Hermes `no_agent` cron to deliver verbatim) what landed in the last 24h, the
 * rows still waiting for review, any broken connection, and where the month
 * stands by fluxo de caixa.
 *
 * The production image ships only `.next/standalone` and cannot run tsx, so this
 * is an HTTP client against a reachable API — same shape as scripts/pluggy-sync.ts.
 *
 *   npm run telegram:daily                       # sync + digest of the last 24h
 *   npm run telegram:daily -- --hours 48         # widen the window
 *   npm run telegram:daily -- --no-sync          # report only, no sync
 */
import {
  CliArgsError,
  describeApiError,
  parseFlags,
  readBody,
  readDotEnvLocal,
  resolveApiKey,
  resolveBaseUrl,
} from './lib/cliEnv';
import { formatDigest } from './lib/reportFormat';
import type { DailyDigest } from '../lib/services/reportService';
import type { MonthForecast } from '../lib/utils/forecast';
import { todayInReportTimeZone } from '../lib/utils/reportDate';

type Args = {
  baseUrl: string;
  apiKey?: string;
  hours: number;
  sync: boolean;
};

const DEFAULT_HOURS = 24;
// A sync holds an advisory lock for its whole pipeline. The Easypanel cron fires
// at the same off-hours slots, so a collision is normal, not an outage: wait it
// out instead of reporting a half-fresh digest.
const LOCK_RETRIES = 2;
const LOCK_WAIT_MS = 30_000;

function parseArgs(argv: string[]): Args {
  const envLocal = readDotEnvLocal();
  const flags = parseFlags(argv, {
    value: ['--base-url', '--api-key', '--hours'],
    boolean: ['--no-sync'],
  });

  const hours = flags.hours === undefined ? DEFAULT_HOURS : Number(flags.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new CliArgsError('--hours deve ser um número positivo.');
  }

  return {
    baseUrl: resolveBaseUrl(envLocal, flags['base-url'] as string | undefined),
    apiKey: resolveApiKey(envLocal, flags['api-key'] as string | undefined),
    hours,
    sync: flags['no-sync'] !== true,
  };
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function request(
  url: string,
  apiKey: string,
  init: RequestInit = {}
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const response = await fetch(url, {
    ...init,
    headers: { 'x-api-key': apiKey, ...(init.headers ?? {}) },
  });
  return { ok: response.ok, status: response.status, body: await readBody(response) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apiKey) {
    console.error('Defina EXPENSES_API_KEY (ou API_KEY) para autenticar na API.');
    process.exit(1);
  }

  let syncBody: unknown = null;
  let locked = false;
  // A failed sync must not swallow the day's message: the digest is still worth
  // sending, and the cron (no_agent) delivers nothing when the script exits 1.
  let syncError: string | null = null;

  if (args.sync) {
    try {
      for (let attempt = 0; attempt <= LOCK_RETRIES; attempt += 1) {
        const result = await request(`${args.baseUrl}/pluggy/sync`, args.apiKey, { method: 'POST' });
        if (!result.ok) {
          syncError = describeApiError(result.status, result.body);
          locked = false;
          break;
        }
        syncBody = result.body;
        locked = Boolean((result.body as { data?: { locked?: boolean } })?.data?.locked);
        if (!locked) break;
        if (attempt < LOCK_RETRIES) await sleep(LOCK_WAIT_MS);
      }
    } catch (error) {
      syncError = error instanceof Error ? error.message : String(error);
      locked = false;
    }
    if (syncError) console.error(`sync falhou: ${syncError}`);
  }

  const since = new Date(Date.now() - args.hours * 3_600_000).toISOString();
  const digestResult = await request(
    `${args.baseUrl}/reports/daily-digest?since=${encodeURIComponent(since)}`,
    args.apiKey
  );
  if (!digestResult.ok) {
    console.error(describeApiError(digestResult.status, digestResult.body));
    process.exit(1);
  }
  const digest = (digestResult.body as { data: DailyDigest }).data;

  // The month line is a nicety: a forecast failure must not swallow the digest.
  let monthToDate: number | null = null;
  try {
    const forecastResult = await request(`${args.baseUrl}/reports/month-forecast`, args.apiKey);
    if (forecastResult.ok) {
      monthToDate = (forecastResult.body as { data: MonthForecast }).data.committed;
    }
  } catch {
    monthToDate = null;
  }

  // The sync body is wrapped in the API envelope: { data: { sync, autoImport? } }.
  const sync = (syncBody as { data?: { sync?: unknown } } | null)?.data?.sync ?? null;

  console.log(
    formatDigest({
      today: todayInReportTimeZone(),
      digest,
      sync: sync as Parameters<typeof formatDigest>[0]['sync'],
      locked,
      synced: args.sync,
      syncError,
      monthToDate,
    })
  );
}

main().catch(error => {
  if (error instanceof CliArgsError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
