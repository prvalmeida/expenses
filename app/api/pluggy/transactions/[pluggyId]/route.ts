import { NextRequest, NextResponse } from 'next/server';
import { unignoreTransaction } from '@/lib/services/pluggyService';

// The review screen's one-click "não ignorar": moves a previously-ignored row
// back to pending so it reappears for classification. Internal, unauthenticated
// — same surface as the rest of app/api/pluggy/, and not part of the plan's
// original step-16 route list, which never anticipated the review screen
// needing to reverse an ignore rule from the UI.
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ pluggyId: string }> }
) {
  const { pluggyId } = await params;
  try {
    const row = await unignoreTransaction(pluggyId);
    if (!row) {
      return NextResponse.json({ error: 'Transação ignorada não encontrada.' }, { status: 404 });
    }
    return NextResponse.json(row);
  } catch (error) {
    return NextResponse.json(
      { error: `Falha ao reverter transação ignorada: ${error}` },
      { status: 500 }
    );
  }
}
