#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Args = {
  text?: string;
  baseUrl: string;
  apiKey?: string;
  dryRun: boolean;
};

function readDotEnvLocal() {
  const path = join(process.cwd(), '.env.local');
  if (!existsSync(path)) return {} as Record<string, string>;

  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)=(.*)\s*$/);
    if (!match) continue;
    values[match[1]] = match[2];
  }
  return values;
}

function parseArgs(argv: string[]): Args {
  const envLocal = readDotEnvLocal();
  const args: Args = {
    baseUrl: process.env.EXPENSES_API_BASE_URL ?? envLocal.EXPENSES_API_BASE_URL ?? 'http://localhost:3000/api/v1',
    apiKey: process.env.EXPENSES_API_KEY ?? process.env.API_KEY ?? envLocal.EXPENSES_API_KEY ?? envLocal.API_KEY,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current === '--text') args.text = argv[++i];
    else if (current === '--base-url') args.baseUrl = argv[++i];
    else if (current === '--api-key') args.apiKey = argv[++i];
    else if (current === '--dry-run') args.dryRun = true;
  }

  return args;
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

  const body = await response.json();
  console.log(JSON.stringify({ status: response.status, ...body }, null, 2));

  if (!response.ok) process.exit(1);
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
