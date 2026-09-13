import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '@/lib/api/respond';
import { importPluggyStagedSchema } from '@/lib/api/schemas/pluggy';
import { importStaged } from '@/lib/services/pluggyService';

// The internal surface keeps its plain `{ error }` envelope, but not its
// cast-and-trust body: a service never inspects payload shape, so without a
// schema here an unbounded body reaches importStaged unchecked (the same rule
// /api/bills/import follows).
export async function POST(request: NextRequest) {
  try {
    const parsed = importPluggyStagedSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 }
      );
    }

    const result = await importStaged(parsed.data.items);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json(
      { error: `Falha ao importar transações Pluggy: ${error}` },
      { status: 500 }
    );
  }
}
