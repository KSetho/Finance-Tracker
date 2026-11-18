import { count as countRows, eq } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { type User, users } from '../db/schema';

export async function getByEmail(db: Executor, email: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function getById(db: Executor, userId: string): Promise<User | null> {
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row ?? null;
}

/** The single owner row, if any (the schema allows at most one). */
export async function getOwner(db: Executor): Promise<User | null> {
  const [row] = await db.select().from(users).limit(1);
  return row ?? null;
}

export async function count(db: Executor): Promise<number> {
  const [row] = await db.select({ value: countRows() }).from(users);
  return row?.value ?? 0;
}

export async function create(
  db: Executor,
  { email, passwordHash, now }: { email: string; passwordHash: string; now: Date },
): Promise<User> {
  const [row] = await db
    .insert(users)
    .values({ id: crypto.randomUUID(), email, passwordHash, createdAt: now, updatedAt: now })
    .returning();
  return row;
}

export async function updatePasswordHash(
  db: Executor,
  userId: string,
  passwordHash: string,
  now: Date,
): Promise<void> {
  await db.update(users).set({ passwordHash, updatedAt: now }).where(eq(users.id, userId));
}
