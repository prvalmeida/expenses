import { NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '@/lib/api/respond';
import { autoImportStaged, forceSyncAll } from '@/lib/services/pluggyService';

// The "sincronizar agora" button. Unlike the v1 cron target, this forces
// Pluggy to refresh every item before re-reading it (see forceSyncAll), and —
// same as the cron — drains the BillMapping-matched rows immediately after.
export async function POST() {
  try {
    const sync = await forceSyncAll();
    if (sync === null) {
      return NextResponse.json({ error: 'Sincronização já em andamento.' }, { status: 409 });
    }

    const autoImport = await autoImportStaged();
    return NextResponse.json({ sync, autoImport });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json(
      { error: `Falha ao sincronizar com a Pluggy: ${error}` },
      { status: 500 }
    );
  }
}
