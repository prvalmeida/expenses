import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { failFrom, ok } from '@/lib/api/respond';
import { mintConnectToken } from '@/lib/services/pluggyService';

// Mints the short-lived token Pluggy Connect uses to create an item in the
// browser. Returns the token value and nothing else — no item/session data
// that a caller could otherwise skip the registration step with.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    return ok(await mintConnectToken());
  } catch (error) {
    return failFrom(error);
  }
}
