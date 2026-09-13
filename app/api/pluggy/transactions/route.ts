import { NextRequest, NextResponse } from 'next/server';
import { listPluggyTransactionsQuerySchema } from '@/lib/api/schemas/pluggy';
import { listPluggyTransactions } from '@/lib/services/pluggyService';

// Internal, unauthenticated — for the review screen only. `?status=pending`
// is the screen's main query; the same keyset pagination as the v1 route
// backs it, since both read the same collection the same way.
export async function GET(request: NextRequest) {
  try {
    const parsed = listPluggyTransactionsQuerySchema.safeParse(
      Object.fromEntries(request.nextUrl.searchParams)
    );
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 }
      );
    }

    return NextResponse.json(await listPluggyTransactions(parsed.data));
  } catch (error) {
    return NextResponse.json(
      { error: `Falha ao listar transações Pluggy: ${error}` },
      { status: 500 }
    );
  }
}
