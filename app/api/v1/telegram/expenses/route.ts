import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { created, fail, failFrom, ok } from '@/lib/api/respond';
import { telegramExpenseTextSchema } from '@/lib/api/schemas/telegram';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { createExpenses } from '@/lib/services/expenseService';
import { parseTelegramExpenseText } from '@/lib/services/telegramExpenseService';
import { resolveExpenseCategoryCasing } from '@/lib/utils/categoryUtils';

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await validateBody(request, telegramExpenseTextSchema);
    if (!body.success) return validationFailed(body.details);

    const parsed = parseTelegramExpenseText(body.data.text);
    if (!parsed.success) return validationFailed(parsed.details);

    const resolvedCategory = await resolveExpenseCategoryCasing(parsed.expense.type, parsed.expense.subtype);
    if (!resolvedCategory) {
      return fail(
        'INVALID_CATEGORY',
        `Categoria ou subcategoria inválida: ${parsed.expense.type} / ${parsed.expense.subtype}`
      );
    }

    const expense = {
      ...parsed.expense,
      type: resolvedCategory.type,
      subtype: resolvedCategory.subtype,
    };

    if (body.data.dryRun) {
      return ok({
        expense,
        recognizedFields: parsed.recognizedFields,
        ignoredLines: parsed.ignoredLines,
      });
    }

    const expenses = await createExpenses(expense);
    return created({
      expense,
      recognizedFields: parsed.recognizedFields,
      ignoredLines: parsed.ignoredLines,
      transactionId: expenses[0]?.transactionId ?? null,
      expenses,
    });
  } catch (error) {
    return failFrom(error);
  }
}
