import { and, asc, count, eq, gt, lte } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { loginAttempts } from '../db/schema';

const clip = (email: string) => email.slice(0, 320);

export async function add(
  db: Executor,
  { sourceIp, email, now }: { sourceIp: string; email: string; now: Date },
): Promise<void> {
  await db.insert(loginAttempts).values({ id: crypto.randomUUID(), sourceIp, email: clip(email), attemptedAt: now });
}

export async function countForIpSince(db: Executor, sourceIp: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.sourceIp, sourceIp), gt(loginAttempts.attemptedAt, since)));
  return row?.value ?? 0;
}

export async function countForEmailSince(db: Executor, email: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, clip(email)), gt(loginAttempts.attemptedAt, since)));
  return row?.value ?? 0;
}

export async function oldestForIpSince(db: Executor, sourceIp: string, since: Date): Promise<Date | null> {
  const [row] = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.sourceIp, sourceIp), gt(loginAttempts.attemptedAt, since)))
    .orderBy(asc(loginAttempts.attemptedAt))
    .limit(1);
  return row?.at ?? null;
}

export async function oldestForEmailSince(db: Executor, email: string, since: Date): Promise<Date | null> {
  const [row] = await db
    .select({ at: loginAttempts.attemptedAt })
    .from(loginAttempts)
    .where(and(eq(loginAttempts.email, clip(email)), gt(loginAttempts.attemptedAt, since)))
    .orderBy(asc(loginAttempts.attemptedAt))
    .limit(1);
  return row?.at ?? null;
}

export async function deleteForIp(db: Executor, sourceIp: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.sourceIp, sourceIp));
}

export async function purgeBefore(db: Executor, cutoff: Date): Promise<void> {
  await db.delete(loginAttempts).where(lte(loginAttempts.attemptedAt, cutoff));
}
