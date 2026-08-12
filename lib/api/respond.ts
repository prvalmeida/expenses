import { NextResponse } from 'next/server';

// Machine-readable error codes for the /api/v1 surface. VALIDATION_FAILED and
// INVALID_CATEGORY are deliberately distinct: the first means the payload is
// malformed (a caller bug), the second means it is well-formed but names a
// category that does not exist — recoverable by re-reading /api/v1/categories.
export const ERROR_STATUS = {
  UNAUTHORIZED: 401,
  VALIDATION_FAILED: 400,
  INVALID_CATEGORY: 400,
  NOT_FOUND: 404,
  PDF_PASSWORD_REQUIRED: 422,
  DOCUMENT_UNREADABLE: 422,
  UPSTREAM_FAILED: 502,
  INTERNAL_ERROR: 500,
} as const;

export type ApiErrorCode = keyof typeof ERROR_STATUS;

// Flattened ZodError issues, keyed by `issue.path.join('.')`.
export type ApiErrorDetails = Record<string, string[]>;

export interface ApiErrorBody {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: ApiErrorDetails;
  };
}

export interface ApiSuccessBody<T> {
  data: T;
}

// Thrown by the service layer, caught by the route handler. Carrying the code
// on the exception is what lets a service signal "wrong PDF password" without
// importing next/server or knowing about HTTP.
export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly details?: ApiErrorDetails
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function ok<T>(data: T, status = 200): NextResponse<ApiSuccessBody<T>> {
  return NextResponse.json({ data }, { status });
}

export function created<T>(data: T): NextResponse<ApiSuccessBody<T>> {
  return ok(data, 201);
}

export function fail(
  code: ApiErrorCode,
  message: string,
  details?: ApiErrorDetails
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    { error: { code, message, ...(details && { details }) } },
    { status: ERROR_STATUS[code] }
  );
}

// Terminal catch for every v1 handler. Anything that is not a deliberate
// ApiError is an internal fault: it is logged server-side and answered with a
// fixed message, so exception dumps and driver detail never reach the caller.
export function failFrom(error: unknown): NextResponse<ApiErrorBody> {
  if (error instanceof ApiError) {
    return fail(error.code, error.message, error.details);
  }
  console.error('[api/v1] unhandled error', error);
  return fail('INTERNAL_ERROR', 'Erro interno ao processar a requisição.');
}
