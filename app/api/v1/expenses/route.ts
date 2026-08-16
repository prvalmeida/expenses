import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { created, fail, failFrom, ok } from '@/lib/api/respond';
import { validateBody, validateQuery, validationFailed } from '@/lib/api/validate';
import { createExpenseSchema, listExpensesQuerySchema } from '@/lib/api/schemas/expense';
import { createExpenses, listExpenses } from '@/lib/services/expenseService';
import { validateExpensePair } from '@/lib/utils/categoryUtils';

export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, listExpensesQuerySchema);
    if (!query.success) return validationFailed(query.details);

    return ok(await listExpenses(query.data));
  } catch (error) {
    return failFrom(error);
  }
}

// Boundary order: auth → Zod → validateExpensePair → service. Category validity
// is a database question against a collection users edit at runtime, so it can
// never move into the schema.
export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await validateBody(request, createExpenseSchema);
    if (!body.success) return validationFailed(body.details);

    const input = body.data;
    if (!(await validateExpensePair(input.type, input.subtype))) {
      return fail(
        'INVALID_CATEGORY',
        `Categoria ou subcategoria inválida: ${input.type}${input.subtype ? ` / ${input.subtype}` : ''}`
      );
    }

    const expenses = await createExpenses(input);

    // The shared transactionId is surfaced explicitly: it is the handle for the
    // whole installment group, which /v1/expenses/transactions/{id} addresses.
    return created({
      transactionId: expenses[0]?.transactionId ?? null,
      expenses,
    });
  } catch (error) {
    return failFrom(error);
  }
}
