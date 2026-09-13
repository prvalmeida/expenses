import { NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '@/lib/api/respond';
import { runPluggySync } from '@/lib/services/pluggyService';

// The "sincronizar agora" button. Unlike the v1 cron target, this forces
// Pluggy to refresh every item before re-reading it (forceRefresh), and —
// same as the cron — runPluggySync drains the BillMapping-matched rows
// immediately after, inside the same advisory-lock hold.
export async function POST() {
  try {
    const result = await runPluggySync({ forceRefresh: true });
    if (result === null) {
      return NextResponse.json({ error: 'Sincronização já em andamento.' }, { status: 409 });
    }

    return NextResponse.json(result);
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
