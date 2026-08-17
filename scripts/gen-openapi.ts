/**
 * Generates public/openapi.yaml from the Zod schemas that actually validate the
 * requests. Hand-writing the spec would let it drift from the boundary the
 * moment a schema changes; generating it turns "the docs are stale" from a
 * code-review catch into a diff.
 *
 * Run with `npm run gen:openapi`, or `npm run gen:openapi -- --check` to fail
 * when the committed file is out of date.
 */
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { stringify } from 'yaml';
import { z } from 'zod';

import {
  createExpenseSchema,
  listExpensesQuerySchema,
  patchExpenseSchema,
  updateExpenseSchema,
} from '../lib/api/schemas/expense';
import { createIncomeSchema, listIncomesQuerySchema } from '../lib/api/schemas/income';
import { importBillSchema, parseBillSchema } from '../lib/api/schemas/bill';
import { importReceiptSchema, parseReceiptUrlSchema } from '../lib/api/schemas/receipt';
import { cardCycleQuerySchema, categoriesQuerySchema } from '../lib/api/schemas/support';
import { ERROR_STATUS } from '../lib/api/respond';

const OUTPUT = join(process.cwd(), 'public', 'openapi.yaml');

type JsonSchema = Record<string, unknown>;

// `io: 'input'` describes what a caller sends: a field with a default is
// optional on the wire even though it is always present in the parsed output.
const toJson = (schema: z.ZodType): JsonSchema =>
  z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'input' }) as JsonSchema;

// Query schemas become `parameters`, not a body schema.
function toParameters(schema: z.ZodType) {
  const json = toJson(schema);
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  const required = (json.required ?? []) as string[];

  return Object.entries(properties).map(([name, propertySchema]) => ({
    name,
    in: 'query',
    required: required.includes(name),
    schema: propertySchema,
  }));
}

const jsonBody = (schema: z.ZodType) => ({
  required: true,
  content: { 'application/json': { schema: toJson(schema) } },
});

const multipartBody = (schema: z.ZodType) => {
  const json = toJson(schema);
  const properties = (json.properties ?? {}) as Record<string, JsonSchema>;
  return {
    required: true,
    content: {
      'multipart/form-data': {
        schema: {
          type: 'object',
          properties: { file: { type: 'string', format: 'binary' }, ...properties },
          required: ['file', ...((json.required ?? []) as string[])],
        },
      },
    },
  };
};

const errorRef = { $ref: '#/components/schemas/Error' };

// Every route runs the guard first, so 401 is universal; the rest are listed
// per operation only where a handler can actually produce them.
const responses = (okStatus: '200' | '201', description: string, extra: string[] = []) => ({
  [okStatus]: { description },
  '400': { description: 'VALIDATION_FAILED ou INVALID_CATEGORY', content: { 'application/json': { schema: errorRef } } },
  '401': { description: 'UNAUTHORIZED', content: { 'application/json': { schema: errorRef } } },
  ...Object.fromEntries(
    extra.map(code => [
      String(ERROR_STATUS[code as keyof typeof ERROR_STATUS]),
      { description: code, content: { 'application/json': { schema: errorRef } } },
    ])
  ),
});

const idParameter = (name: string) => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string' },
});

const document = {
  openapi: '3.0.3',
  info: {
    title: 'Expenses API',
    version: '1.0.0',
    description:
      'API pública do gerenciador de finanças. Todas as rotas exigem o header x-api-key ' +
      '(ou Authorization: Bearer). Categorias são editáveis em tempo de execução: consulte ' +
      '/v1/categories antes de escrever, e trate INVALID_CATEGORY relendo essa lista.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ apiKey: [] }],
  paths: {
    '/expenses': {
      get: {
        summary: 'Lista gastos com filtros e paginação por cursor',
        parameters: toParameters(listExpensesQuerySchema),
        responses: responses('200', 'Página de gastos e o nextCursor'),
      },
      post: {
        summary: 'Cria uma compra, expandindo as parcelas no servidor',
        requestBody: jsonBody(createExpenseSchema),
        responses: responses('201', 'Os N registros criados e o transactionId compartilhado'),
      },
    },
    '/expenses/{id}': {
      parameters: [idParameter('id')],
      get: { summary: 'Busca um gasto', responses: responses('200', 'O gasto', ['NOT_FOUND']) },
      put: {
        summary: 'Substitui os oito campos editáveis de um gasto',
        requestBody: jsonBody(updateExpenseSchema),
        responses: responses('200', 'O gasto atualizado', ['NOT_FOUND']),
      },
      patch: {
        summary: 'Atualiza parte dos campos editáveis',
        requestBody: jsonBody(patchExpenseSchema),
        responses: responses('200', 'O gasto atualizado', ['NOT_FOUND']),
      },
      delete: {
        summary: 'Exclui um único registro',
        responses: responses('200', 'Quantidade excluída', ['NOT_FOUND']),
      },
    },
    '/expenses/transactions/{transactionId}': {
      parameters: [idParameter('transactionId')],
      get: {
        summary: 'Lista todas as parcelas de uma compra',
        responses: responses('200', 'As parcelas do grupo', ['NOT_FOUND']),
      },
      delete: {
        summary: 'Exclui a compra inteira (todas as parcelas)',
        responses: responses('200', 'Quantidade excluída', ['NOT_FOUND']),
      },
    },
    '/incomes': {
      get: {
        summary: 'Lista receitas',
        parameters: toParameters(listIncomesQuerySchema),
        responses: responses('200', 'Página de receitas e o nextCursor'),
      },
      post: {
        summary: 'Cria uma receita',
        requestBody: jsonBody(createIncomeSchema),
        responses: responses('201', 'A receita criada'),
      },
    },
    '/incomes/{id}': {
      parameters: [idParameter('id')],
      get: { summary: 'Busca uma receita', responses: responses('200', 'A receita', ['NOT_FOUND']) },
      put: {
        summary: 'Atualiza uma receita',
        requestBody: jsonBody(createIncomeSchema),
        responses: responses('200', 'A receita atualizada', ['NOT_FOUND']),
      },
      delete: {
        summary: 'Exclui uma receita',
        responses: responses('200', 'Quantidade excluída', ['NOT_FOUND']),
      },
    },
    '/bills/parse': {
      post: {
        summary: 'Extrai as transações de um PDF de fatura',
        description:
          'A resposta é reenviável a /bills/import sem transformação. `password` só é ' +
          'necessário para faturas protegidas; o padrão é a variável PDF_KEY do servidor.',
        requestBody: multipartBody(parseBillSchema),
        responses: responses('200', 'items, cardBrand, closingDate e dueDate', [
          'PDF_PASSWORD_REQUIRED',
          'DOCUMENT_UNREADABLE',
        ]),
      },
    },
    '/bills/import': {
      post: {
        summary: 'Importa as transações revisadas de uma fatura',
        description:
          'Itens com type null ou categoria inexistente contam como skippedInvalid e são ' +
          'os únicos acionáveis; skippedExisting é o resultado esperado de faturas com ' +
          'sobreposição. Subtipos inválidos para o tipo são descartados sem bloquear a linha.',
        requestBody: jsonBody(importBillSchema),
        responses: responses('201', '{ imported, skippedInvalid, skippedExisting }'),
      },
    },
    '/receipts/parse': {
      post: {
        summary: 'Interpreta uma NF-e a partir de um PDF (multipart) ou de um link SEFAZ (JSON)',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                properties: { file: { type: 'string', format: 'binary' } },
                required: ['file'],
              },
            },
            'application/json': { schema: toJson(parseReceiptUrlSchema) },
          },
        },
        responses: responses('200', 'Loja e itens classificados', [
          'DOCUMENT_UNREADABLE',
          'UPSTREAM_FAILED',
        ]),
      },
    },
    '/receipts/import': {
      post: {
        summary: 'Importa os itens confirmados de uma NF-e',
        description:
          'Diferente da fatura, um par (type, subtype) inválido rejeita o lote inteiro com ' +
          'INVALID_CATEGORY.',
        requestBody: jsonBody(importReceiptSchema),
        responses: responses('201', 'Os gastos criados'),
      },
    },
    '/categories': {
      get: {
        summary: 'Lista as categorias e subtipos válidos',
        parameters: toParameters(categoriesQuerySchema),
        responses: responses('200', 'As categorias'),
      },
    },
    '/card-cycles': {
      get: {
        summary: 'Consulta o ciclo (fechamento/vencimento) de um cartão',
        parameters: toParameters(cardCycleQuerySchema),
        responses: responses('200', 'closingDate e dueDate do ciclo'),
      },
    },
  },
  components: {
    securitySchemes: {
      apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string', enum: Object.keys(ERROR_STATUS) },
              message: { type: 'string' },
              details: {
                type: 'object',
                additionalProperties: { type: 'array', items: { type: 'string' } },
              },
            },
          },
        },
      },
    },
  },
};

const yaml = stringify(document, { lineWidth: 0 });

if (process.argv.includes('--check')) {
  const current = (() => {
    try {
      return readFileSync(OUTPUT, 'utf8');
    } catch {
      return '';
    }
  })();

  if (current !== yaml) {
    console.error('public/openapi.yaml está desatualizado. Rode `npm run gen:openapi`.');
    process.exit(1);
  }
  console.log('public/openapi.yaml está atualizado.');
} else {
  writeFileSync(OUTPUT, yaml);
  console.log(`Gerado ${OUTPUT}`);
}
