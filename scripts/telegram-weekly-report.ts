#!/usr/bin/env node
/**
 * Weekly Telegram analysis input: prints the month forecast as JSON. The Hermes
 * agent writes the message from this — every number it may quote is here, so the
 * narration cannot invent one.
 *
 * In the first days of a month the week that just ended was the *closing* of the
 * previous month, so both are printed:
 *   { current: MonthForecast, previous?: MonthForecast }
 *
 *   npm run telegram:weekly
 *   npm run telegram:weekly -- --month 2026-10 --today 2026-10-31
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
import { shiftMonth, type MonthForecast } from '../lib/utils/forecast';

// Days into a new month during which the previous month's closing is still the
// interesting report.
const CLOSING_WINDOW_DAYS = 3;

type Args = {
  baseUrl: string;
  apiKey?: string;
  month?: string;
  today?: string;
  savingsGoal?: string;
};

function parseArgs(argv: string[]): Args {
  const envLocal = readDotEnvLocal();
  const flags = parseFlags(argv, {
    value: ['--base-url', '--api-key', '--month', '--today', '--savings-goal'],
    boolean: [],
  });

  return {
    baseUrl: resolveBaseUrl(envLocal, flags['base-url'] as string | undefined),
    apiKey: resolveApiKey(envLocal, flags['api-key'] as string | undefined),
    month: flags.month as string | undefined,
    today: flags.today as string | undefined,
    savingsGoal: flags['savings-goal'] as string | undefined,
  };
}

function todayInReportTimeZone(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function lastDayOfMonth(month: string): string {
  const [year, monthNumber] = month.split('-').map(Number);
  const day = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return `${month}-${String(day).padStart(2, '0')}`;
}

async function fetchForecast(
  baseUrl: string,
  apiKey: string,
  params: Record<string, string>
): Promise<MonthForecast> {
  const query = new URLSearchParams(params).toString();
  const response = await fetch(`${baseUrl}/reports/month-forecast?${query}`, {
    headers: { 'x-api-key': apiKey },
  });
  const body = await readBody(response);
  if (!response.ok) {
    console.error(describeApiError(response.status, body));
    process.exit(1);
  }
  return (body as { data: MonthForecast }).data;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.apiKey) {
    console.error('Defina EXPENSES_API_KEY (ou API_KEY) para autenticar na API.');
    process.exit(1);
  }

  const today = args.today ?? todayInReportTimeZone();
  const month = args.month ?? today.slice(0, 7);
  const extra: Record<string, string> = args.savingsGoal ? { savingsGoal: args.savingsGoal } : {};

  const current = await fetchForecast(args.baseUrl, args.apiKey, { month, ...extra });
  const dayOfMonth = Number(today.slice(8, 10));

  const payload: { current: MonthForecast; previous?: MonthForecast } = { current };
  if (dayOfMonth <= CLOSING_WINDOW_DAYS) {
    const previousMonth = shiftMonth(month, -1);
    payload.previous = await fetchForecast(args.baseUrl, args.apiKey, {
      month: previousMonth,
      today: lastDayOfMonth(previousMonth),
      ...extra,
    });
  }

  console.log(JSON.stringify(payload, null, 2));
}

main().catch(error => {
  if (error instanceof CliArgsError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
