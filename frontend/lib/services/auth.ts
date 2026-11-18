import { randomBytes } from 'node:crypto';

import {
  csrfTokenFor,
  dummyHash,
  hashPassword,
  hashToken,
  needsRehash,
  newSessionToken,
  verifyPassword,
} from '../auth/crypto';
import { getClock } from '../clock';
import { normalizeEmail, type Settings } from '../config';
import { addHours, addMinutes, isoDateTime } from '../dates';
import { getDb, isIntegrityError } from '../db/client';
import type { Session, User } from '../db/schema';
import type { EmailSender } from '../email';
import { InvalidCredentials, InvalidResetToken, Unauthenticated } from '../errors';
import * as passwordResetRepository from '../repositories/passwordResets';
import * as sessionRepository from '../repositories/sessions';
import * as userRepository from '../repositories/users';
import { seedDefaults } from './category';
import * as throttle from './throttle';

export interface AuthContext {
  user: User;
  session: Session;
  token: string;
  userId: string;
}

export interface LoginResult {
  user: User;
  token: string;
  csrfToken: string;
  expiresAt: Date;
  maxAgeSeconds: number;
}

export async function login(
  settings: Settings,
  { email, password, sourceIp }: { email: string; password: string; sourceIp: string },
): Promise<LoginResult> {
  const normalized = normalizeEmail(email);
  const now = getClock().now();
  const lifetimeSeconds = settings.sessionAbsoluteDays * 86_400;

  const outcome = await getDb().transaction(async (tx) => {
    await throttle.purge(tx, settings, now);
    await throttle.check(tx, settings, now, sourceIp, normalized);

    let user: User | null = null;
    if (normalized === settings.ownerEmail) {
      const candidate = await userRepository.getByEmail(tx, normalized);
      if (candidate !== null && candidate.isActive) user = candidate;
    }

    // Always exactly one verification: against a dummy hash when there is no usable owner, so
    // a wrong email costs the same as a wrong password and the response is identical.
    const passwordOk = await verifyPassword(user ? user.passwordHash : await dummyHash(), password);
    if (user === null || !passwordOk) {
      // Committed: the failure is kept even though the request ends in an error.
      await throttle.recordFailure(tx, now, sourceIp, normalized);
      return null;
    }

    await throttle.clear(tx, sourceIp);

    if (needsRehash(user.passwordHash)) {
      await userRepository.updatePasswordHash(tx, user.id, await hashPassword(password), now);
    }

    await sessionRepository.purgeExpired(tx, { now, idleCutoff: addHours(now, -settings.sessionIdleHours) });
    const token = newSessionToken();
    const row = await sessionRepository.create(tx, {
      userId: user.id,
      tokenHash: hashToken(token),
      now,
      expiresAt: new Date(now.getTime() + lifetimeSeconds * 1000),
    });
    return { user, token, row };
  });

  if (outcome === null) {
    console.warn(`login_failed source_ip=${sourceIp}`);
    throw new InvalidCredentials();
  }
  console.info(`login_success user_id=${outcome.user.id} source_ip=${sourceIp}`);
  return {
    user: outcome.user,
    token: outcome.token,
    csrfToken: csrfTokenFor(outcome.token, settings.secretKey),
    expiresAt: outcome.row.expiresAt,
    maxAgeSeconds: lifetimeSeconds,
  };
}

const LAST_SEEN_REFRESH_MS = 5 * 60_000;

/** The signed-in owner for a session token, or throw Unauthenticated. */
export async function validateSession(settings: Settings, token: string | null | undefined): Promise<AuthContext> {
  if (!token) throw new Unauthenticated();
  const db = getDb();
  const now = getClock().now();
  const row = await sessionRepository.getByTokenHash(db, hashToken(token));
  if (row === null || row.revokedAt !== null || row.expiresAt <= now) throw new Unauthenticated();
  const idleMs = now.getTime() - row.lastSeenAt.getTime();
  if (idleMs > settings.sessionIdleHours * 3_600_000) throw new Unauthenticated();
  const user = await userRepository.getById(db, row.userId);
  if (user === null || !user.isActive || user.email !== settings.ownerEmail) throw new Unauthenticated();
  if (idleMs >= LAST_SEEN_REFRESH_MS) await sessionRepository.touch(db, row, now);
  return { user, session: row, token, userId: user.id };
}

export async function logout(context: AuthContext): Promise<void> {
  await sessionRepository.revoke(getDb(), context.session, getClock().now());
  console.info(`logout user_id=${context.userId}`);
}

export function sessionResponsePayload(context: AuthContext, settings: Settings) {
  return {
    user: { id: context.user.id, email: context.user.email },
    csrf_token: csrfTokenFor(context.token, settings.secretKey),
    expires_at: isoDateTime(context.session.expiresAt),
  };
}

export const MIN_PASSWORD_LENGTH = 10;

/** An administrative owner operation was refused (shown to the administrator as-is). */
export class OwnerAdminError extends Error {}

function validateNewPassword(password: string): void {
  if ([...password].length < MIN_PASSWORD_LENGTH) {
    throw new OwnerAdminError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
}

/** Create the single owner account. Refuses a second owner or a non-owner email. */
export async function provisionOwner(
  settings: Settings,
  { email, password }: { email: string; password: string },
): Promise<User> {
  const normalized = normalizeEmail(email);
  if (normalized !== settings.ownerEmail) throw new OwnerAdminError('Email does not match OWNER_EMAIL.');
  const db = getDb();
  if ((await userRepository.count(db)) > 0) throw new OwnerAdminError('An owner already exists.');
  validateNewPassword(password);
  const passwordHash = await hashPassword(password);
  try {
    return await db.transaction(async (tx) => {
      const user = await userRepository.create(tx, { email: normalized, passwordHash, now: getClock().now() });
      await seedDefaults(tx, user.id);
      return user;
    });
  } catch (error) {
    // Lost a race: the single-owner index rejected a second row.
    if (isIntegrityError(error)) throw new OwnerAdminError('An owner already exists.');
    throw error;
  }
}

/** Set a new owner password and end every existing session in one transaction.
 * Takes no email: the account can only be reset, never re-assigned. */
export async function resetOwnerPassword(settings: Settings, { password }: { password: string }): Promise<void> {
  const db = getDb();
  const owner = await userRepository.getOwner(db);
  if (owner === null) throw new OwnerAdminError('No owner exists. Run provision-owner first.');
  if (owner.email !== settings.ownerEmail) throw new OwnerAdminError('Stored owner email does not match OWNER_EMAIL.');
  validateNewPassword(password);
  const passwordHash = await hashPassword(password);
  const now = getClock().now();
  await db.transaction(async (tx) => {
    await userRepository.updatePasswordHash(tx, owner.id, passwordHash, now);
    await sessionRepository.revokeAllForUser(tx, owner.id, now);
  });
}

/** Create and send a single-use owner reset token, while always returning silently. */
export async function requestPasswordReset(
  settings: Settings,
  sender: EmailSender,
  { email, sourceIp }: { email: string; sourceIp: string },
): Promise<void> {
  if (!settings.passwordResetEnabled) {
    console.info(`password_reset_requested source_ip=${sourceIp}`);
    return;
  }
  const db = getDb();
  const clock = getClock();
  const normalized = normalizeEmail(email);
  const owner = await userRepository.getByEmail(db, settings.ownerEmail);
  const since = () => addMinutes(clock.now(), -settings.passwordResetWindowMinutes);
  if (
    normalized !== settings.ownerEmail ||
    owner === null ||
    !owner.isActive ||
    (await passwordResetRepository.countForSourceSince(db, sourceIp, since())) >= settings.passwordResetMaxRequests ||
    (await passwordResetRepository.countForUserSince(db, owner.id, since())) >= settings.passwordResetMaxRequests
  ) {
    console.info(`password_reset_requested source_ip=${sourceIp}`);
    return;
  }

  const now = clock.now();
  const rawToken = randomBytes(32).toString('base64url');
  const row = await db.transaction(async (tx) => {
    await passwordResetRepository.invalidateActiveForUser(tx, owner.id, now);
    return passwordResetRepository.create(tx, {
      userId: owner.id,
      tokenHash: hashToken(rawToken),
      sourceIp,
      now,
      expiresAt: addMinutes(now, settings.passwordResetExpiryMinutes),
    });
  });

  const resetUrl = `${settings.frontendOrigin}/reset-password?token=${encodeURIComponent(rawToken)}`;
  try {
    await sender.sendPasswordReset(owner.email, resetUrl, settings.passwordResetExpiryMinutes);
    console.info(`password_reset_sent user_id=${owner.id} source_ip=${sourceIp}`);
  } catch (error) {
    // Delivery failures are hidden from the caller and the raw token is never logged.
    // Invalidate the unsent token so it cannot remain usable.
    await passwordResetRepository.consume(db, row, clock.now());
    const errorType = error instanceof Error ? error.constructor.name : typeof error;
    console.warn(`password_reset_delivery_failed source_ip=${sourceIp} error_type=${errorType}`);
  }
}

export async function resetPasswordWithToken(
  settings: Settings,
  { token, password }: { token: string; password: string },
): Promise<void> {
  if (!settings.passwordResetEnabled) throw new InvalidResetToken();
  validateNewPassword(password);
  const now = getClock().now();
  const ownerId = await getDb().transaction(async (tx) => {
    const row = await passwordResetRepository.getActiveByHashForUpdate(tx, hashToken(token), now);
    if (row === null) throw new InvalidResetToken();
    const owner = await userRepository.getById(tx, row.userId);
    if (owner === null || !owner.isActive) throw new InvalidResetToken();

    await userRepository.updatePasswordHash(tx, owner.id, await hashPassword(password), now);
    await passwordResetRepository.consume(tx, row, now);
    await sessionRepository.revokeAllForUser(tx, owner.id, now);
    return owner.id;
  });
  console.info(`password_reset_completed user_id=${ownerId}`);
}
