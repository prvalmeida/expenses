import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '@/lib/api/respond';
import { updateAccountLinkSchema } from '@/lib/api/schemas/pluggy';
import { listAccountLinks, updateAccountLink } from '@/lib/services/pluggyService';

export async function GET() {
  try {
    return NextResponse.json(await listAccountLinks());
  } catch (error) {
    return NextResponse.json({ error: `Falha ao listar contas Pluggy: ${error}` }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const parsed = updateAccountLinkSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 }
      );
    }

    const account = await updateAccountLink(parsed.data);
    if (!account) {
      return NextResponse.json({ error: 'Conta Pluggy não encontrada.' }, { status: 404 });
    }

    return NextResponse.json(account);
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json(
      { error: `Falha ao atualizar conta Pluggy: ${error}` },
      { status: 500 }
    );
  }
}
