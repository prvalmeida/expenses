import { NextRequest, NextResponse } from 'next/server';
import { ZodError, ZodType } from 'zod';
import { ApiErrorBody, ApiErrorDetails, fail } from './respond';

export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; details: ApiErrorDetails };

function toDetails(error: ZodError): ApiErrorDetails {
  const details: ApiErrorDetails = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    (details[key] ??= []).push(issue.message);
  }
  return details;
}

// A raw ZodError serialized to the client would leak the internal schema shape,
// so issues are flattened into the { path: [messages] } map the error envelope
// exposes.
function toResult<T>(schema: ZodType<T>, input: unknown): ValidationResult<T> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { success: true, data: parsed.data }
    : { success: false, details: toDetails(parsed.error) };
}

// JSON bodies are parsed without coercion: coercing here would turn
// {"value": "abc"} into an expense with a NaN amount.
export async function validateBody<T>(
  request: NextRequest,
  schema: ZodType<T>
): Promise<ValidationResult<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return { success: false, details: { _: ['Corpo da requisição não é JSON válido.'] } };
  }
  return toResult(schema, body);
}

// Query values always arrive as strings, so query schemas are the one place
// z.coerce belongs — the caller's schema opts in per field.
export function validateQuery<T>(
  params: URLSearchParams,
  schema: ZodType<T>
): ValidationResult<T> {
  return toResult(schema, Object.fromEntries(params));
}

export function validationFailed(details: ApiErrorDetails): NextResponse<ApiErrorBody> {
  return fail('VALIDATION_FAILED', 'Payload inválido.', details);
}
