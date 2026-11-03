import { NextRequest, NextResponse } from 'next/server';
import { ignoreTransaction } from '@/lib/services/pluggyService';

// The review screen's "Ignorar": parks one pending row as ignored for good —
// later syncs keep it ignored (PluggyIgnore), while other purchases at the same
// store on other dates still come in. Reversed by PATCH on the parent route
// ("Não ignorar"). Internal, unauthenticated — same surface as the rest of
// app/api/pluggy/.
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ pluggyId: string }> }
) {
  const { pluggyId } = await params;
  try {
    const row = await ignoreTransaction(pluggyId);
    if (!row) {
      return NextResponse.json({ error: 'Transação pendente não encontrada.' }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json({ error: `Falha ao ignorar transação: ${error}` }, { status: 500 });
  }
}
