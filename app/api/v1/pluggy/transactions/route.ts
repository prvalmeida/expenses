import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { failFrom, ok } from '@/lib/api/respond';
import { validateQuery, validationFailed } from '@/lib/api/validate';
import { listPluggyTransactionsQuerySchema } from '@/lib/api/schemas/pluggy';
import { listPluggyTransactions } from '@/lib/services/pluggyService';

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, listPluggyTransactionsQuerySchema);
    if (!query.success) return validationFailed(query.details);

    return ok(await listPluggyTransactions(query.data));
  } catch (error) {
    return failFrom(error);
  }
}
