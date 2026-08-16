import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { created, failFrom } from '@/lib/api/respond';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { importReceiptSchema } from '@/lib/api/schemas/receipt';
import { importReceiptItems } from '@/lib/services/receiptService';

// Unlike the bill import, an invalid (type, subtype) pair rejects the whole
// batch with INVALID_CATEGORY — a receipt is one purchase, so a partial import
// would leave the caller reconciling by hand.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await validateBody(request, importReceiptSchema);
    if (!body.success) return validationFailed(body.details);

    const expenses = await importReceiptItems(body.data);
    return created({ imported: expenses.length, expenses });
  } catch (error) {
    return failFrom(error);
  }
}
