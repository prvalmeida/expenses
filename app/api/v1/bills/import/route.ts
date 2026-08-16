import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { created, failFrom } from '@/lib/api/respond';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { importBillSchema } from '@/lib/api/schemas/bill';
import { importBillItems } from '@/lib/services/billService';

// Takes the caller's edited parse response back. Category validity is resolved
// per item inside the service rather than rejecting the batch: a row whose type
// no longer exists counts as skippedInvalid, and only skippedInvalid is
// actionable — skippedExisting is the expected result of overlapping bills.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await validateBody(request, importBillSchema);
    if (!body.success) return validationFailed(body.details);

    return created(await importBillItems(body.data));
  } catch (error) {
    return failFrom(error);
  }
}
