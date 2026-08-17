import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { failFrom, ok } from '@/lib/api/respond';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { parseReceiptUrlSchema } from '@/lib/api/schemas/receipt';
import { parseReceiptFromPdf, parseReceiptFromUrl } from '@/lib/services/receiptService';

// One endpoint for both sources — today's receipts/parse and receipts/parse-url
// already return the identical ParseResponse, so merging them costs the caller
// nothing and saves it a second code path.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const isMultipart = request.headers
      .get('content-type')
      ?.includes('multipart/form-data');

    if (isMultipart) {
      const file = (await request.formData()).get('file');
      if (!(file instanceof File)) {
        return validationFailed({ file: ['Arquivo PDF não enviado.'] });
      }
      return ok(await parseReceiptFromPdf(Buffer.from(await file.arrayBuffer())));
    }

    const body = await validateBody(request, parseReceiptUrlSchema);
    if (!body.success) return validationFailed(body.details);

    // The SEFAZ allowlist lives in the service: it is an SSRF guard on a path an
    // authenticated external caller can reach, so it must not be re-approximated
    // here.
    return ok(await parseReceiptFromUrl(body.data.url));
  } catch (error) {
    return failFrom(error);
  }
}
