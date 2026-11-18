import { and, count, eq, gt } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { reportRequests } from '../db/schema';

export async function countForUserSince(db: Executor, userId: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(reportRequests)
    .where(and(eq(reportRequests.userId, userId), gt(reportRequests.createdAt, since)));
  return row?.value ?? 0;
}

export async function countForSourceSince(db: Executor, sourceIp: string, since: Date): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(reportRequests)
    .where(and(eq(reportRequests.sourceIp, sourceIp), gt(reportRequests.createdAt, since)));
  return row?.value ?? 0;
}

export async function create(
  db: Executor,
  { userId, sourceIp, now }: { userId: string; sourceIp: string; now: Date },
): Promise<void> {
  await db
    .insert(reportRequests)
    .values({ id: crypto.randomUUID(), userId, sourceIp: sourceIp.slice(0, 64), createdAt: now });
}
