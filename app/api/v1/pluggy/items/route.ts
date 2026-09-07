import { NextRequest } from 'next/server';
import { requireApiKey } from '@/lib/api/auth';
import { created, failFrom, ok } from '@/lib/api/respond';
import { validateBody, validationFailed } from '@/lib/api/validate';
import { registerPluggyItemSchema } from '@/lib/api/schemas/pluggy';
import { listItems, registerItem } from '@/lib/services/pluggyService';

// Item health, for monitoring — LOGIN_ERROR / WAITING_USER_ACTION show up here
// before they show up as a missing sync.
export async function GET(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    return ok(await listItems());
  } catch (error) {
    return failFrom(error);
  }
}

export async function POST(request: NextRequest) {
  const unauthorized = requireApiKey(request);
  if (unauthorized) return unauthorized;

  try {
    const body = await validateBody(request, registerPluggyItemSchema);
    if (!body.success) return validationFailed(body.details);

    return created(await registerItem(body.data));
  } catch (error) {
    return failFrom(error);
  }
}
