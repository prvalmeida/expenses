import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '@/lib/api/respond';
import { registerPluggyItemSchema } from '@/lib/api/schemas/pluggy';
import { listItems, registerItem } from '@/lib/services/pluggyService';

// Internal counterpart to the v1 items route: PluggyConfig needs to both list
// items (status badges) and register the itemId Pluggy Connect hands back in
// the browser, and a browser cannot carry API_KEY to reach /api/v1/pluggy/items
// for either.
export async function GET() {
  try {
    return NextResponse.json(await listItems());
  } catch (error) {
    return NextResponse.json({ error: `Falha ao listar itens Pluggy: ${error}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const parsed = registerPluggyItemSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 }
      );
    }

    const result = await registerItem(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao registrar item Pluggy: ${error}` }, { status: 500 });
  }
}
