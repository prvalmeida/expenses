import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CliArgsError,
  describeApiError,
  parseFlags,
  readDotEnvLocal,
  resolveApiKey,
} from '../scripts/lib/cliEnv';

test('parseFlags reads values and boolean flags', () => {
  const flags = parseFlags(['--category', 'comida', '--dry-run'], {
    value: ['--category'],
    boolean: ['--dry-run'],
  });

  assert.equal(flags.category, 'comida');
  assert.equal(flags['dry-run'], true);
});

test('parseFlags throws when a value flag has no value', () => {
  assert.throws(() => parseFlags(['--category'], { value: ['--category'] }), CliArgsError);
  assert.throws(() => parseFlags(['--category', ''], { value: ['--category'] }), CliArgsError);
  assert.throws(
    () => parseFlags(['--category', '--api-key', 'k'], { value: ['--category', '--api-key'] }),
    CliArgsError
  );
});

test('parseFlags ignores unknown tokens', () => {
  const flags = parseFlags(['--unknown', 'x', '--category', 'comida'], { value: ['--category'] });
  assert.deepEqual(flags, { category: 'comida' });
});

test('readDotEnvLocal strips surrounding quotes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cli-env-'));
  writeFileSync(join(dir, '.env.local'), 'API_KEY="abc"\nEXPENSES_API_BASE_URL=\'http://x/api/v1\'\n# comment\nPLAIN=value\n');

  const values = readDotEnvLocal(dir);
  assert.equal(values.API_KEY, 'abc');
  assert.equal(values.EXPENSES_API_BASE_URL, 'http://x/api/v1');
  assert.equal(values.PLAIN, 'value');
});

test('resolveApiKey prefers the explicit override over the env file', () => {
  assert.equal(resolveApiKey({ API_KEY: 'from-file' }, 'from-flag'), 'from-flag');
  assert.equal(resolveApiKey({ API_KEY: 'from-file' }), process.env.EXPENSES_API_KEY ?? process.env.API_KEY ?? 'from-file');
});

test('describeApiError surfaces the v1 envelope', () => {
  assert.equal(
    describeApiError(401, { error: { code: 'UNAUTHORIZED', message: 'API não configurada.' } }),
    '401 [UNAUTHORIZED]: API não configurada.'
  );
  assert.match(describeApiError(400, { error: { message: 'inválido', details: { kind: 'x' } } }), /inválido \{"kind":"x"\}/);
  assert.equal(describeApiError(502, '<html>oops</html>'), '502: <html>oops</html>');
  assert.equal(describeApiError(500, null), '500');
});
