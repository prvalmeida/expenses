import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { ok, failFrom } from '@/lib/api/respond';
import { validateQuery, validationFailed } from '@/lib/api/validate';
import { syncPluggyQuerySchema } from '@/lib/api/schemas/pluggy';
import { autoImportStaged, syncAccount, syncAll } from '@/lib/services/pluggyService';

// The cron target (Easypanel, every 6h). Never forces a Pluggy refresh —
// PATCH /items/:id is reserved for the internal "sincronizar agora" button —
// so this only re-reads what Pluggy already has. A non-dryRun sync is
// immediately followed by autoImportStaged: this route is the only automated
// trigger in the pipeline, so filling staging without also draining the
// BillMapping-matched rows would leave every mapped merchant waiting on a
// human forever.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, syncPluggyQuerySchema);
    if (!query.success) return validationFailed(query.details);

    const { dryRun, accountId } = query.data;

    const sync = accountId ? await syncAccount(accountId, { dryRun }) : await syncAll({ dryRun });

    // syncAll returns null when another run already holds the advisory lock —
    // not an error, just nothing to report this time.
    if (sync === null) return ok({ locked: true });

    const autoImport = dryRun ? undefined : await autoImportStaged();

    return ok({ sync, ...(autoImport && { autoImport }) });
  } catch (error) {
    return failFrom(error);
  }
}
