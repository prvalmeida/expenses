import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { fail, failFrom, ok } from '@/lib/api/respond';
import { listMigrations, runPendingMigrations } from '@/lib/services/migrationService';

// The production entry point for data migrations. It lives behind the API key
// and returns the v1 envelope even though it sits under /api/admin: the guard
// answers with that envelope, so the success path has to match.
//
// Why a route rather than a script in the image: the `runner` stage ships only
// .next/standalone, and every dependency outside serverExternalPackages —
// mongoose included — is bundled into the compiled server chunks rather than
// installed as a module. A standalone script inside that image could not
// require a driver. Running inside the server is where the connection already
// is. `scripts/migrate.ts` drives the same service from a full checkout.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    return ok(await listMigrations());
  } catch (error) {
    return failFrom(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    // Defaults to applying. `?dryRun=true` reports the counts each pending
    // migration would produce and writes nothing — not even a ledger row.
    const dryRun = request.nextUrl.searchParams.get('dryRun') === 'true';
    const report = await runPendingMigrations({ dryRun });

    if (report.failed) {
      return fail('INTERNAL_ERROR', `Migração ${report.failed.name} falhou.`, {
        [report.failed.name]: [report.failed.error],
        applied: report.applied.map(a => a.name),
        skipped: report.skipped,
      });
    }

    return ok(report);
  } catch (error) {
    return failFrom(error);
  }
}
