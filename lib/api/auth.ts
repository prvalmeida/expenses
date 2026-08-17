import { createHash, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { ApiErrorBody, fail } from './respond';

const HEADER = 'x-api-key';

function presentedKey(request: NextRequest): string | null {
  const header = request.headers.get(HEADER);
  if (header) return header;

  const authorization = request.headers.get('authorization');
  const bearer = authorization?.match(/^Bearer\s+(.+)$/i);
  return bearer?.[1] ?? null;
}

// Compared as fixed-length digests: timingSafeEqual throws on a length
// mismatch, and comparing raw keys would leak the expected length through that
// throw and through the comparison's own duration.
function matches(presented: string, expected: string): boolean {
  return timingSafeEqual(
    createHash('sha256').update(presented).digest(),
    createHash('sha256').update(expected).digest()
  );
}

// Returns an error response when the request must be rejected, or null when it
// may proceed. API_KEY is read here rather than at module scope: `next build`
// deliberately runs with no secrets in CI, and a module-scope read would make
// the build depend on one.
export function requireApiKey(request: NextRequest): NextResponse<ApiErrorBody> | null {
  const expected = process.env.API_KEY;

  // Fail closed. Treating an unset key as "auth disabled" would turn a
  // misconfigured deploy into an open financial database.
  if (!expected) {
    return fail('UNAUTHORIZED', 'API não configurada.');
  }

  const presented = presentedKey(request);
  if (!presented || !matches(presented, expected)) {
    return fail('UNAUTHORIZED', 'Credencial inválida ou ausente.');
  }

  return null;
}
