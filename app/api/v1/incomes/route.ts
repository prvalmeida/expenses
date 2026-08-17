import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { created, fail, failFrom, ok } from '@/lib/api/respond';
import { validateBody, validateQuery, validationFailed } from '@/lib/api/validate';
import { createIncomeSchema, listIncomesQuerySchema } from '@/lib/api/schemas/income';
import { createIncome, listIncomes } from '@/lib/services/incomeService';
import { validateIncomeType } from '@/lib/utils/categoryUtils';

// Plural, unlike the existing /api/income: the rename is what lets the internal
// route keep its current contract for Dashboard.tsx and AddIncome.tsx.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, listIncomesQuerySchema);
    if (!query.success) return validationFailed(query.details);

    return ok(await listIncomes(query.data));
  } catch (error) {
    return failFrom(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await validateBody(request, createIncomeSchema);
    if (!body.success) return validationFailed(body.details);

    if (!(await validateIncomeType(body.data.type))) {
      return fail('INVALID_CATEGORY', `Tipo de receita inválido: ${body.data.type}`);
    }

    return created(await createIncome(body.data));
  } catch (error) {
    return failFrom(error);
  }
}
