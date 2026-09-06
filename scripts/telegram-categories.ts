#!/usr/bin/env node

import {
  CliArgsError,
  describeApiError,
  parseFlags,
  readBody,
  readDotEnvLocal,
  resolveApiKey,
  resolveBaseUrl,
} from './lib/cliEnv';

type Category = {
  kind: string;
  name: string;
  subtypes: string[];
  order?: number;
};

type Args = {
  baseUrl: string;
  apiKey?: string;
  category?: string;
};

function parseArgs(argv: string[]): Args {
  const envLocal = readDotEnvLocal();
  const flags = parseFlags(argv, { value: ['--category', '--base-url', '--api-key'] });

  return {
    baseUrl: resolveBaseUrl(envLocal, flags['base-url'] as string | undefined),
    apiKey: resolveApiKey(envLocal, flags['api-key'] as string | undefined),
    category: flags.category as string | undefined,
  };
}

function isCategoryList(value: unknown): value is Category[] {
  return Array.isArray(value) && value.every((item) => item && typeof item === 'object' && typeof (item as Category).name === 'string');
}

/** Accepts the printed index as well as the name, since the output is numbered. */
function selectCategory(sorted: Category[], answer: string) {
  const index = Number(answer);
  if (Number.isInteger(index) && index >= 1 && index <= sorted.length) return sorted[index - 1];
  return sorted.find((c) => c.name.toLowerCase() === answer.toLowerCase());
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

  const body = await readBody(response);

  if (!response.ok) {
    console.error(`Erro ao buscar categorias: ${describeApiError(response.status, body)}`);
    process.exit(1);
  }

  const payload = (body as { data?: unknown } | null)?.data ?? body;
  if (!isCategoryList(payload)) {
    console.error(`Resposta inesperada de ${args.baseUrl}/categories — verifique EXPENSES_API_BASE_URL.`);
    process.exit(1);
  }

  const sorted = payload
    .filter((c) => c.kind === 'expense')
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

  if (!args.category) {
    if (sorted.length === 0) {
      console.error('Nenhuma categoria de despesa cadastrada.');
      process.exit(1);
    }
    sorted.forEach((cat, index) => {
      console.log(`${index + 1}) ${cat.name}`);
    });
    return;
  }

  const selected = selectCategory(sorted, args.category);
  if (!selected) {
    console.error(`Categoria nao encontrada: ${args.category}`);
    process.exit(1);
  }

  if (selected.subtypes.length === 0) {
    console.error(`A categoria "${selected.name}" nao tem subcategorias cadastradas.`);
    process.exit(1);
  }

  selected.subtypes.forEach((sub, index) => {
    console.log(`${index + 1}) ${sub}`);
  });
}

main().catch((error) => {
  if (error instanceof CliArgsError) {
    console.error(error.message);
    console.error('Uso: npm run telegram:categories -- [--category "<nome ou numero>"]');
    process.exit(2);
  }
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
