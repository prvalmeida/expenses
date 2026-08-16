import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { failFrom, ok } from '@/lib/api/respond';
import { validateQuery, validationFailed } from '@/lib/api/validate';
import { cardCycleQuerySchema } from '@/lib/api/schemas/support';
import connectToDatabase from '@/lib/mongodb';
import { getCycle } from '@/lib/utils/cycleUtils';

// Read-only: writing a cycle recalculates effectiveDate across existing
// expenses, which is an operator action, not something a public caller should
// trigger. Reading it lets a caller predict the effectiveDate a POST will
// derive without duplicating computeEffectiveDate.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, cardCycleQuerySchema);
    if (!query.success) return validationFailed(query.details);

    const { brand, month, year } = query.data;
    await connectToDatabase();

    return ok({ cardBrand: brand, month, year, ...(await getCycle(brand, month, year)) });
  } catch (error) {
    return failFrom(error);
  }
}
