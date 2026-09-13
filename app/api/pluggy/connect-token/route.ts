import { NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '@/lib/api/respond';
import { mintConnectToken } from '@/lib/services/pluggyService';

// Internal counterpart to the v1 route of the same name: a browser cannot
// carry API_KEY, so PluggyConfig mints its Pluggy Connect widget token here
// instead. Returns the token value and nothing else — no item/session data
// that a caller could otherwise skip the registration step with.
export async function POST() {
  try {
    return NextResponse.json(await mintConnectToken());
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json(
      { error: `Falha ao gerar token de conexão Pluggy: ${error}` },
      { status: 500 }
    );
  }
}
