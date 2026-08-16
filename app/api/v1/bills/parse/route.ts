import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { failFrom, ok } from '@/lib/api/respond';
import { validateFields, validationFailed } from '@/lib/api/validate';
import { parseBillSchema } from '@/lib/api/schemas/bill';
import { parseBill } from '@/lib/services/billService';

// Multipart only: it is what the review screen posts and it avoids the ~33%
// size penalty base64 would add to a statement PDF.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return validationFailed({ file: ['Arquivo PDF não enviado.'] });
    }

    const fields = validateFields(
      {
        cardBrand: formData.get('cardBrand') ?? undefined,
        password: formData.get('password') ?? undefined,
      },
      parseBillSchema
    );
    if (!fields.success) return validationFailed(fields.details);

    // The response is deliberately re-postable to /v1/bills/import as-is.
    return ok(
      await parseBill({
        buffer: new Uint8Array(await file.arrayBuffer()),
        cardBrand: fields.data.cardBrand,
        password: fields.data.password,
      })
    );
  } catch (error) {
    return failFrom(error);
  }
}
