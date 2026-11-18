import { and, eq, isNotNull, isNull, lte, ne, or } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { type Session, sessions } from '../db/schema';

export async function create(
  db: Executor,
  { userId, tokenHash, now, expiresAt }: { userId: string; tokenHash: string; now: Date; expiresAt: Date },
): Promise<Session> {
  const [row] = await db
    .insert(sessions)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      createdAt: now,
      lastSeenAt: now,
      expiresAt,
    })
    .returning();
  return row;
}

export async function getByTokenHash(db: Executor, tokenHash: string): Promise<Session | null> {
  const [row] = await db.select().from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  return row ?? null;
}

export async function touch(db: Executor, session: Session, now: Date): Promise<void> {
  await db.update(sessions).set({ lastSeenAt: now }).where(eq(sessions.id, session.id));
  session.lastSeenAt = now;
}

export async function revoke(db: Executor, session: Session, now: Date): Promise<void> {
  if (session.revokedAt === null) {
    await db.update(sessions).set({ revokedAt: now }).where(eq(sessions.id, session.id));
    session.revokedAt = now;
  }
}

export async function revokeAllForUser(db: Executor, userId: string, now: Date): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning({ id: sessions.id });
  return rows.length;
}

export async function revokeOthersForUser(
  db: Executor,
  userId: string,
  { keepSessionId, now }: { keepSessionId: string; now: Date },
): Promise<number> {
  const rows = await db
    .update(sessions)
    .set({ revokedAt: now })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt), ne(sessions.id, keepSessionId)))
    .returning({ id: sessions.id });
  return rows.length;
}

/** Delete rows that can never be valid again (revoked, absolutely expired, or idle too long). */
export async function purgeExpired(
  db: Executor,
  { now, idleCutoff }: { now: Date; idleCutoff: Date },
): Promise<number> {
  const rows = await db
    .delete(sessions)
    .where(or(isNotNull(sessions.revokedAt), lte(sessions.expiresAt, now), lte(sessions.lastSeenAt, idleCutoff)))
    .returning({ id: sessions.id });
  return rows.length;
}
