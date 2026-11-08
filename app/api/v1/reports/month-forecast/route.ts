import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { ok, failFrom } from '@/lib/api/respond';
import { validateQuery, validationFailed } from '@/lib/api/validate';
import { monthForecastQuerySchema } from '@/lib/api/schemas/report';
import { getMonthForecast } from '@/lib/services/reportService';

// Read-only forecast of the month by the "fluxo de caixa" basis (effectiveDate),
// used by the weekly Telegram analysis. Deterministic: every number here comes
// from monthForecast(), so the same query always returns the same answer.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, monthForecastQuerySchema);
    if (!query.success) return validationFailed(query.details);

    return ok(await getMonthForecast(query.data));
  } catch (error) {
    return failFrom(error);
  }
}
