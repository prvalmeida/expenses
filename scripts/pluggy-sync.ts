#!/usr/bin/env node
/**
 * Runs a Pluggy sync from a checkout — the development convenience. The
 * `runner` image ships only `.next/standalone` and cannot run a tsx script,
 * so production hits POST /api/v1/pluggy/sync (the Easypanel cron target)
 * directly.
 *
 * Unlike scripts/migrate.ts — which imports migrationService and talks to
 * Mongo in-process — this is an HTTP client against a running server, the
 * same shape as the Telegram bridge scripts (scripts/lib/cliEnv.ts). It
 * therefore needs a reachable base URL and API_KEY, not MONGODB_URI, and the
 * sync logic still lives in exactly one place: the route's pluggyService call.
 *
 *   npm run pluggy:sync                    # sync every enabled account
 *   npm run pluggy:sync -- --dry-run       # counts only, writes nothing
 *   npm run pluggy:sync -- --account <id>  # sync one account
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

type Args = {
  baseUrl: string;
  apiKey?: string;
  dryRun: boolean;
  accountId?: string;
};

function parseArgs(argv: string[]): Args {
  const envLocal = readDotEnvLocal();
  const flags = parseFlags(argv, {
    value: ['--account', '--base-url', '--api-key'],
    boolean: ['--dry-run'],
  });

  return {
    baseUrl: resolveBaseUrl(envLocal, flags['base-url'] as string | undefined),
    apiKey: resolveApiKey(envLocal, flags['api-key'] as string | undefined),
    dryRun: flags['dry-run'] === true,
    accountId: flags.account as string | undefined,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.apiKey) {
    console.error('Defina EXPENSES_API_KEY (ou API_KEY) para autenticar na API.');
    process.exit(1);
  }

  const query = new URLSearchParams();
  if (args.dryRun) query.set('dryRun', 'true');
  if (args.accountId) query.set('accountId', args.accountId);
  const qs = query.toString();

  console.log(`Modo: ${args.dryRun ? 'dry-run (nenhuma escrita)' : 'sincronizar'}${args.accountId ? ` — conta ${args.accountId}` : ' — todas as contas habilitadas'}\n`);

  const response = await fetch(`${args.baseUrl}/pluggy/sync${qs ? `?${qs}` : ''}`, {
    method: 'POST',
    headers: { 'x-api-key': args.apiKey },
  });

  const body = await readBody(response);

  if (!response.ok) {
    console.error(describeApiError(response.status, body));
    process.exit(1);
  }

  console.log(JSON.stringify(body, null, 2));
}

main().catch(error => {
  if (error instanceof CliArgsError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
