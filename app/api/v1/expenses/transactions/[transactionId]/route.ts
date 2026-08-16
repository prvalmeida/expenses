import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { fail, failFrom, ok } from '@/lib/api/respond';
import { deleteExpenseGroup, listExpenseGroup } from '@/lib/services/expenseService';

type RouteContext = { params: Promise<{ transactionId: string }> };

// The installment group as a resource. `?all=true` on a record id is awkward for
// a caller that thinks in terms of "the purchase" — which is how the data is
// actually modelled, since every installment shares one transactionId.
export async function GET(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { transactionId } = await params;
    const expenses = await listExpenseGroup(transactionId);
    if (expenses.length === 0) return fail('NOT_FOUND', 'Compra não encontrada.');

    return ok({ transactionId, expenses });
  } catch (error) {
    return failFrom(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { transactionId } = await params;
    const result = await deleteExpenseGroup(transactionId);
    if (!result) return fail('NOT_FOUND', 'Compra não encontrada.');

    return ok(result);
  } catch (error) {
    return failFrom(error);
  }
}
