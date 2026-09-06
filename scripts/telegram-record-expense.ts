#!/usr/bin/env node

import {
  CliArgsError,
  parseFlags,
  readBody,
  readDotEnvLocal,
  resolveApiKey,
  resolveBaseUrl,
} from './lib/cliEnv';

type Args = {
  text?: string;
  baseUrl: string;
  apiKey?: string;
  dryRun: boolean;
};

function parseArgs(argv: string[]): Args {
  const envLocal = readDotEnvLocal();
  const flags = parseFlags(argv, {
    value: ['--text', '--base-url', '--api-key'],
    boolean: ['--dry-run'],
  });

  return {
    text: flags.text as string | undefined,
    baseUrl: resolveBaseUrl(envLocal, flags['base-url'] as string | undefined),
    apiKey: resolveApiKey(envLocal, flags['api-key'] as string | undefined),
    dryRun: flags['dry-run'] === true,
  };
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const text = args.text ?? (process.stdin.isTTY ? '' : await readStdin());

  if (!text) {
    console.error('Uso: npm run telegram:record -- --text "nome: ...; valor: ...; categoria: ...; subcategoria: ...; pagamento: ..."');
    process.exit(1);
  }

  if (!args.apiKey) {
    console.error('Defina EXPENSES_API_KEY (ou API_KEY) para autenticar na API.');
    process.exit(1);
  }

  const response = await fetch(`${args.baseUrl}/telegram/expenses`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
    },
    body: JSON.stringify({ text, dryRun: args.dryRun }),
  });

  const body = await readBody(response);
  console.log(JSON.stringify({ status: response.status, ...(body && typeof body === 'object' ? body : { body }) }, null, 2));

  if (!response.ok) process.exit(1);
}

main().catch(error => {
  if (error instanceof CliArgsError) {
    console.error(error.message);
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
