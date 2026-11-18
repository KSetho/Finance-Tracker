import { and, count, desc, eq, gt, isNull } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { type DataWipeToken, dataWipeTokens } from '../db/schema';

export async function countForSourceSince(db: Executor, sourceIp: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(dataWipeTokens)
    .where(and(eq(dataWipeTokens.sourceIp, sourceIp), gt(dataWipeTokens.createdAt, since)));
  return row?.value ?? 0;
}

export async function countForUserSince(db: Executor, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(dataWipeTokens)
    .where(and(eq(dataWipeTokens.userId, userId), gt(dataWipeTokens.createdAt, since)));
  return row?.value ?? 0;
}

export async function invalidateActiveForUser(db: Executor, userId: string, now: Date): Promise<number> {
  const rows = await db
    .update(dataWipeTokens)
    .set({ consumedAt: now })
    .where(and(eq(dataWipeTokens.userId, userId), isNull(dataWipeTokens.consumedAt)))
    .returning({ id: dataWipeTokens.id });
  return rows.length;
}

export async function create(
  db: Executor,
  {
    userId,
    tokenHash,
    sourceIp,
    now,
    expiresAt,
  }: { userId: string; tokenHash: string; sourceIp: string; now: Date; expiresAt: Date },
): Promise<DataWipeToken> {
  const [row] = await db
    .insert(dataWipeTokens)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      sourceIp: sourceIp.slice(0, 64),
      attemptCount: 0,
      createdAt: now,
      expiresAt,
    })
    .returning();
  return row;
}

export async function getActiveForUserForUpdate(
  db: Executor,
  userId: string,
  now: Date,
): Promise<DataWipeToken | null> {
  const [row] = await db
    .select()
    .from(dataWipeTokens)
    .where(and(eq(dataWipeTokens.userId, userId), isNull(dataWipeTokens.consumedAt), gt(dataWipeTokens.expiresAt, now)))
    .orderBy(desc(dataWipeTokens.createdAt))
    .limit(1)
    .for('update');
  return row ?? null;
}

export async function consume(db: Executor, row: DataWipeToken, now: Date): Promise<void> {
  await db.update(dataWipeTokens).set({ consumedAt: now }).where(eq(dataWipeTokens.id, row.id));
  row.consumedAt = now;
}

export async function recordFailedAttempt(db: Executor, row: DataWipeToken): Promise<number> {
  row.attemptCount += 1;
  await db.update(dataWipeTokens).set({ attemptCount: row.attemptCount }).where(eq(dataWipeTokens.id, row.id));
  return row.attemptCount;
}
