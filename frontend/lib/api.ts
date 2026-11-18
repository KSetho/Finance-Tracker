/**
 * Route Handler wrappers reproducing the FastAPI dependency order for /api/v1:
 * trusted origin (unsafe methods) -> session -> CSRF (unsafe methods) -> handler.
 * Every thrown AppError becomes the {"error": {code, message}} response.
 */
import type { NextRequest } from 'next/server';

import { requireCsrf, requireTrustedOrigin } from './auth/csrf';
import { type AuthContext, requireAuth } from './auth/session';
import { toErrorResponse } from './http';

type Params = Record<string, string>;
type RouteContext<P extends Params> = { params: Promise<P> };

export interface PublicArgs<P extends Params> {
  request: NextRequest;
  params: P;
}

export interface OwnerArgs<P extends Params> extends PublicArgs<P> {
  auth: AuthContext;
}

/** No session required (login, password reset, health). */
export function publicRoute<P extends Params = Params>(handler: (args: PublicArgs<P>) => Promise<Response>) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      requireTrustedOrigin(request);
      return await handler({ request, params: await context.params });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}

/** Signed-in owner required; CSRF token checked on unsafe methods unless `csrf: false`. */
export function ownerRoute<P extends Params = Params>(
  handler: (args: OwnerArgs<P>) => Promise<Response>,
  { csrf = true }: { csrf?: boolean } = {},
) {
  return async (request: NextRequest, context: RouteContext<P>): Promise<Response> => {
    try {
      requireTrustedOrigin(request);
      const auth = await requireAuth(request);
      if (csrf) requireCsrf(request, auth);
      return await handler({ request, params: await context.params, auth });
    } catch (error) {
      return toErrorResponse(error);
    }
  };
}
