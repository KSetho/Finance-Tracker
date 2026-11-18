import { and, asc, eq, inArray } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { categories, type Category, type CategoryType } from '../db/schema';

export async function listForUser(
  db: Executor,
  userId: string,
  categoryType: CategoryType | null = null,
): Promise<Category[]> {
  const where =
    categoryType === null
      ? eq(categories.userId, userId)
      : and(eq(categories.userId, userId), eq(categories.categoryType, categoryType));
  return db.select().from(categories).where(where).orderBy(asc(categories.categoryType), asc(categories.name));
}

export async function getOwned(db: Executor, userId: string, categoryId: string): Promise<Category | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.id, categoryId), eq(categories.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function getFeesCategory(db: Executor, userId: string): Promise<Category | null> {
  const [row] = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.categoryType, 'expense'), eq(categories.name, 'Fees')))
    .limit(1);
  return row ?? null;
}

/** Idempotent: existing (user, type, name) rows are left alone. */
export async function insertMissing(
  db: Executor,
  userId: string,
  rows: ReadonlyArray<readonly [string, CategoryType]>,
): Promise<void> {
  for (const [name, categoryType] of rows) {
    await db
      .insert(categories)
      .values({ id: crypto.randomUUID(), userId, name, categoryType, isSystem: true })
      .onConflictDoNothing({ target: [categories.userId, categories.categoryType, categories.name] });
  }
}

export async function getMany(
  db: Executor,
  userId: string,
  categoryIds: Iterable<string>,
): Promise<Map<string, Category>> {
  const ids = [...new Set(categoryIds)];
  if (ids.length === 0) return new Map();
  const rows = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), inArray(categories.id, ids)));
  return new Map(rows.map((row) => [row.id, row]));
}
