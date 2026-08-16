import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { fail, failFrom, ok } from '@/lib/api/respond';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { updateIncomeSchema } from '@/lib/api/schemas/income';
import { deleteIncome, getIncome, updateIncome } from '@/lib/services/incomeService';
import { validateIncomeType } from '@/lib/utils/categoryUtils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const income = await getIncome(id);
    if (!income) return fail('NOT_FOUND', 'Receita não encontrada.');

    return ok(income);
  } catch (error) {
    return failFrom(error);
  }
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const body = await validateBody(request, updateIncomeSchema);
    if (!body.success) return validationFailed(body.details);

    if (!(await validateIncomeType(body.data.type))) {
      return fail('INVALID_CATEGORY', `Tipo de receita inválido: ${body.data.type}`);
    }

    const updated = await updateIncome(id, body.data);
    if (!updated) return fail('NOT_FOUND', 'Receita não encontrada.');

    return ok(updated);
  } catch (error) {
    return failFrom(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const deleted = await deleteIncome(id);
    if (!deleted) return fail('NOT_FOUND', 'Receita não encontrada.');

    return ok({ deletedCount: 1 });
  } catch (error) {
    return failFrom(error);
  }
}
