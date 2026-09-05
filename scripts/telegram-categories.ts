#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Category = {
  kind: string;
  name: string;
  subtypes: string[];
  order?: number;
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

function parseArgs(argv: string[]) {
  const envLocal = readDotEnvLocal();
  const args = {
    baseUrl: process.env.EXPENSES_API_BASE_URL ?? envLocal.EXPENSES_API_BASE_URL ?? 'http://localhost:3000/api/v1',
    apiKey: process.env.EXPENSES_API_KEY ?? process.env.API_KEY ?? envLocal.EXPENSES_API_KEY ?? envLocal.API_KEY,
    category: undefined as string | undefined,
  };

  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (current === '--category') args.category = argv[++i];
    else if (current === '--base-url') args.baseUrl = argv[++i];
    else if (current === '--api-key') args.apiKey = argv[++i];
  }

  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.apiKey) {
    console.error('Defina EXPENSES_API_KEY (ou API_KEY) para autenticar na API.');
    process.exit(1);
  }

  const response = await fetch(`${args.baseUrl}/categories?kind=expense`, {
    method: 'GET',
    headers: {
      'content-type': 'application/json',
      'x-api-key': args.apiKey,
    },
  });

  if (!response.ok) {
    console.error(`Erro ao buscar categorias: ${response.status}`);
    process.exit(1);
  }

  const body = await response.json();
  const categories: Category[] = body.data ?? body;
  const sorted = categories
    .filter((c) => c.kind === 'expense')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (args.category) {
    const categoryName = args.category;
    const selected = sorted.find((c) => c.name.toLowerCase() === categoryName.toLowerCase());
    if (!selected) {
      console.error(`Categoria nao encontrada: ${categoryName}`);
      process.exit(1);
    }
    selected.subtypes.forEach((sub, index) => {
      console.log(`${index + 1}) ${sub}`);
    });
  } else {
    sorted.forEach((cat, index) => {
      console.log(`${index + 1}) ${cat.name}`);
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
