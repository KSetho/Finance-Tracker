/** Resolve the signed-in owner from the session cookie (backend/app/dependencies/auth.py). */
import type { NextRequest, NextResponse } from 'next/server';

import { getSettings, type Settings } from '../config';
import { type AuthContext, validateSession } from '../services/auth';

export type { AuthContext };

/** The owner's AuthContext (touching last_seen_at when due), or throw Unauthenticated. */
export async function requireAuth(request: NextRequest): Promise<AuthContext> {
  const settings = getSettings();
  const token = request.cookies.get(settings.sessionCookieName)?.value;
  return validateSession(settings, token);
}

export function setSessionCookie(
  response: NextResponse,
  settings: Settings,
  token: string,
  maxAgeSeconds: number,
): void {
  response.cookies.set({
    name: settings.sessionCookieName,
    value: token,
    maxAge: maxAgeSeconds,
    httpOnly: true,
    secure: settings.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}

export function clearSessionCookie(response: NextResponse, settings: Settings): void {
  response.cookies.set({
    name: settings.sessionCookieName,
    value: '',
    maxAge: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: settings.cookieSecure,
    sameSite: 'lax',
    path: '/',
  });
}
