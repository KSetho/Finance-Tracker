import { and, count, eq, gt, isNull } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { type PasswordResetToken, passwordResetTokens } from '../db/schema';

export async function countForSourceSince(db: Executor, sourceIp: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.sourceIp, sourceIp), gt(passwordResetTokens.createdAt, since)));
  return row?.value ?? 0;
}

export async function countForUserSince(db: Executor, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(passwordResetTokens)
    .where(and(eq(passwordResetTokens.userId, userId), gt(passwordResetTokens.createdAt, since)));
  return row?.value ?? 0;
}

export async function invalidateActiveForUser(db: Executor, userId: string, now: Date): Promise<number> {
  const rows = await db
    .update(passwordResetTokens)
    .set({ consumedAt: now })
    .where(and(eq(passwordResetTokens.userId, userId), isNull(passwordResetTokens.consumedAt)))
    .returning({ id: passwordResetTokens.id });
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
): Promise<PasswordResetToken> {
  const [row] = await db
    .insert(passwordResetTokens)
    .values({
      id: crypto.randomUUID(),
      userId,
      tokenHash,
      sourceIp: sourceIp.slice(0, 64),
      createdAt: now,
      expiresAt,
    })
    .returning();
  return row;
}

export async function getActiveByHashForUpdate(
  db: Executor,
  tokenHash: string,
  now: Date,
): Promise<PasswordResetToken | null> {
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, tokenHash),
        isNull(passwordResetTokens.consumedAt),
        gt(passwordResetTokens.expiresAt, now),
      ),
    )
    .for('update');
  return row ?? null;
}

export async function consume(db: Executor, row: PasswordResetToken, now: Date): Promise<void> {
  await db.update(passwordResetTokens).set({ consumedAt: now }).where(eq(passwordResetTokens.id, row.id));
  row.consumedAt = now;
}
