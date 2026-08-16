import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { fail, failFrom, ok } from '@/lib/api/respond';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { patchExpenseSchema, updateExpenseSchema } from '@/lib/api/schemas/expense';
import {
  deleteExpense,
  getExpense,
  resolveExpensePatch,
  updateExpense,
  UpdateExpenseInput,
} from '@/lib/services/expenseService';
import { validateExpensePair } from '@/lib/utils/categoryUtils';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const expense = await getExpense(id);
    if (!expense) return fail('NOT_FOUND', 'Gasto não encontrado.');

    return ok(expense);
  } catch (error) {
    return failFrom(error);
  }
}

// PUT and PATCH share a write path: the difference is only whether the input is
// complete or resolved against the stored record first. Both go through
// updateExpense, so neither can miss the credit → non-credit $unset rule.
async function write(id: string, input: UpdateExpenseInput) {
  if (!(await validateExpensePair(input.type, input.subtype))) {
    return fail(
      'INVALID_CATEGORY',
      `Categoria ou subcategoria inválida: ${input.type}${input.subtype ? ` / ${input.subtype}` : ''}`
    );
  }

  const updated = await updateExpense(id, input);
  if (!updated) return fail('NOT_FOUND', 'Gasto não encontrado.');

  return ok(updated);
}

export async function PUT(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const body = await validateBody(request, updateExpenseSchema);
    if (!body.success) return validationFailed(body.details);

    return await write(id, body.data);
  } catch (error) {
    return failFrom(error);
  }
}

export async function PATCH(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const body = await validateBody(request, patchExpenseSchema);
    if (!body.success) return validationFailed(body.details);

    const merged = await resolveExpensePatch(id, body.data);
    if (!merged) return fail('NOT_FOUND', 'Gasto não encontrado.');

    return await write(id, merged);
  } catch (error) {
    return failFrom(error);
  }
}

export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const { id } = await params;
    const result = await deleteExpense(id);
    if (!result) return fail('NOT_FOUND', 'Gasto não encontrado.');

    return ok(result);
  } catch (error) {
    return failFrom(error);
  }
}
