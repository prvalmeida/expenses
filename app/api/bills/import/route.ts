import { NextRequest, NextResponse } from 'next/server';
import { ApiError, ERROR_STATUS } from '../../../../lib/api/respond';
import { importBillSchema } from '../../../../lib/api/schemas/bill';
import { importBillItems } from '../../../../lib/services/billService';

export async function POST(request: NextRequest) {
  try {
    // The internal surface keeps its plain `{ error }` envelope, but not its
    // cast-and-trust body: a service never inspects payload shape, so without a
    // schema here an unbounded installmentTotal reaches buildExpenseDocuments.
    const parsed = importBillSchema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues.map(i => i.message).join('; ') },
        { status: 400 }
      );
    }

    const result = await importBillItems(parsed.data);
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json({ error: error.message }, { status: ERROR_STATUS[error.code] });
    }
    return NextResponse.json({ error: `Falha ao importar fatura: ${error}` }, { status: 500 });
  }
}
