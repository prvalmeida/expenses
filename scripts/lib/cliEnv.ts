import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export class CliArgsError extends Error {}

// `KEY="value"` and `KEY='value'` are valid dotenv, but the quotes are
// delimiters — sending them in an x-api-key header 401s with no clue why.
function stripQuotes(value: string) {
  const trimmed = value.trim();
  const quote = trimmed[0];
  if ((quote === '"' || quote === "'") && trimmed.length > 1 && trimmed.endsWith(quote)) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

export function readDotEnvLocal(cwd: string = process.cwd()): Record<string, string> {
  const path = join(cwd, '.env.local');
  if (!existsSync(path)) return {};

  const values: Record<string, string> = {};
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=(.*)$/);
    if (!match) continue;
    values[match[1]] = stripQuotes(match[2]);
  }
  return values;
}

type FlagSpec = {
  value?: readonly string[];
  boolean?: readonly string[];
};

/**
 * Unknown tokens are ignored (the callers are driven by an assistant that may
 * pass extra context), but a declared value flag with no value throws instead
 * of silently resolving to `undefined` and wiping an env-derived default.
 */
export function parseFlags(argv: string[], spec: FlagSpec): Record<string, string | true> {
  const flags: Record<string, string | true> = {};

  for (let i = 0; i < argv.length; i++) {
    const current = argv[i];
    if (spec.value?.includes(current)) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--') || next.trim() === '') {
        throw new CliArgsError(`A opção ${current} exige um valor.`);
      }
      flags[current.replace(/^--/, '')] = next;
      i++;
    } else if (spec.boolean?.includes(current)) {
      flags[current.replace(/^--/, '')] = true;
    }
  }

  return flags;
}

export const DEFAULT_BASE_URL = 'http://localhost:3000/api/v1';

export function resolveBaseUrl(envLocal: Record<string, string>, override?: string) {
  return override ?? process.env.EXPENSES_API_BASE_URL ?? envLocal.EXPENSES_API_BASE_URL ?? DEFAULT_BASE_URL;
}

export function resolveApiKey(envLocal: Record<string, string>, override?: string) {
  return (
    override ??
    process.env.EXPENSES_API_KEY ??
    process.env.API_KEY ??
    envLocal.EXPENSES_API_KEY ??
    envLocal.API_KEY
  );
}

/** Turns a response body into the clearest message the API gave us. */
export function describeApiError(status: number, body: unknown) {
  const envelope = (body as { error?: { code?: string; message?: string; details?: unknown } } | null)?.error;
  if (envelope?.message) {
    const code = envelope.code ? ` [${envelope.code}]` : '';
    const details = envelope.details ? ` ${JSON.stringify(envelope.details)}` : '';
    return `${status}${code}: ${envelope.message}${details}`;
  }
  if (typeof body === 'string' && body.trim()) return `${status}: ${body.trim().slice(0, 300)}`;
  if (body && typeof body === 'object') return `${status}: ${JSON.stringify(body).slice(0, 300)}`;
  return String(status);
}

/** Parses a JSON body when possible, falling back to the raw text. */
export async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
