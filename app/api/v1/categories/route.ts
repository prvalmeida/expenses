import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { failFrom, ok } from '@/lib/api/respond';
import { validateQuery, validationFailed } from '@/lib/api/validate';
import { categoriesQuerySchema } from '@/lib/api/schemas/support';
import { getCategories } from '@/lib/utils/categoryUtils';

// Read-only, and the discovery endpoint for every write: categories are
// DB-driven and user-editable, so an external caller has no other way to learn
// which (type, subtype) pairs a write will accept.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const query = validateQuery(request.nextUrl.searchParams, categoriesQuerySchema);
    if (!query.success) return validationFailed(query.details);

    const categories = await getCategories();
    const kind = query.data.kind;

    return ok(kind ? categories.filter(c => c.kind === kind) : categories);
  } catch (error) {
    return failFrom(error);
  }
}
