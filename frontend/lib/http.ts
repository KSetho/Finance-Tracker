/** JSON responses in the FastAPI error shape: {"error": {"code", "message"}}. */
import { NextResponse } from 'next/server';

import { AppError, RequestValidationError } from './errors';

export function errorBody(code: string, message: string) {
  return { error: { code, message } };
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json(errorBody(code, message), { status, headers });
}

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(data, { status, headers });
}

export function noContent(): NextResponse {
  return new NextResponse(null, { status: 204 });
}

/** Render any thrown value: AppErrors keep their status/code/headers, anything else is a 500. */
export function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof AppError) {
    return errorResponse(error.status, error.code, error.message, error.headers);
  }
  console.error('unhandled_error', error);
  return errorResponse(500, 'internal_error', 'Something went wrong.');
}

/** The JSON object body, or a 422 validation error for anything else. */
export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new RequestValidationError();
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new RequestValidationError();
  }
  return body as Record<string, unknown>;
}
