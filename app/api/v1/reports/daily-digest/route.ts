import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { ok, failFrom } from '@/lib/api/respond';
import { validateQuery, validationFailed } from '@/lib/api/validate';
import { dailyDigestQuerySchema } from '@/lib/api/schemas/report';
import { getDailyDigest } from '@/lib/services/reportService';

// What landed since `since`, by record creation time — the daily Telegram
// message. Reports the staged-but-not-imported rows too: a sync that stopped
// importing (a bank in LOGIN_ERROR, a Pluggy deprecation) looks exactly like a
// quiet day otherwise.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, dailyDigestQuerySchema);
    if (!query.success) return validationFailed(query.details);

    return ok(await getDailyDigest({ since: new Date(query.data.since) }));
  } catch (error) {
    return failFrom(error);
  }
}
