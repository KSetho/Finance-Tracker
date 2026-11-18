/** Origin check and session-bound CSRF token (backend/app/dependencies/csrf.py). */
import { getSettings } from '../config';
import { CsrfFailed, OriginNotAllowed } from '../errors';
import type { AuthContext } from '../services/auth';
import { csrfTokenFor, safeEqual } from './crypto';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function requestOrigin(request: Request): string | null {
  const origin = request.headers.get('origin');
  if (origin) return origin.toLowerCase();
  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const url = new URL(referer);
      if (url.protocol && url.host) return `${url.protocol}//${url.host}`.toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

/** Reject state-changing requests that do not come from the configured frontend origin. */
export function requireTrustedOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  if (requestOrigin(request) !== getSettings().frontendOrigin.toLowerCase()) {
    throw new OriginNotAllowed();
  }
}

/** Synchronizer token bound to the session (HMAC of the session token). */
export function requireCsrf(request: Request, context: AuthContext): void {
  if (SAFE_METHODS.has(request.method)) return;
  const provided = request.headers.get('x-csrf-token');
  const expected = csrfTokenFor(context.token, getSettings().secretKey);
  if (!provided || !safeEqual(provided, expected)) throw new CsrfFailed();
}
