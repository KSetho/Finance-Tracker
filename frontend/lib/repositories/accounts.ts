import { and, asc, eq, inArray, min, ne, or, sql } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { type Account, accounts, transactions } from '../db/schema';

export async function listForUser(db: Executor, userId: string, includeArchived: boolean): Promise<Account[]> {
  const where = includeArchived
    ? eq(accounts.userId, userId)
    : and(eq(accounts.userId, userId), eq(accounts.isArchived, false));
  return db.select().from(accounts).where(where).orderBy(asc(accounts.createdAt), asc(accounts.name));
}

export async function getOwned(
  db: Executor,
  userId: string,
  accountId: string,
  forUpdate = false,
): Promise<Account | null> {
  const query = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
  const [row] = forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

/** The owner's accounts by id, locked in id order so concurrent writers cannot deadlock. */
export async function getManyOwned(
  db: Executor,
  userId: string,
  accountIds: Iterable<string>,
  forUpdate = false,
): Promise<Map<string, Account>> {
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return new Map();
  const query = db
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), inArray(accounts.id, ids)))
    .orderBy(asc(accounts.id));
  const rows = forUpdate ? await query.for('update') : await query;
  return new Map(rows.map((row) => [row.id, row]));
}

export async function add(db: Executor, values: typeof accounts.$inferInsert): Promise<Account> {
  const [row] = await db.insert(accounts).values(values).returning();
  return row;
}

export async function update(
  db: Executor,
  accountId: string,
  values: Partial<typeof accounts.$inferInsert>,
): Promise<Account> {
  const [row] = await db.update(accounts).set(values).where(eq(accounts.id, accountId)).returning();
  return row;
}

export async function nameExists(
  db: Executor,
  userId: string,
  name: string,
  excludeId: string | null = null,
): Promise<boolean> {
  const conditions = [eq(accounts.userId, userId), sql`lower(${accounts.name}) = ${name.toLowerCase()}`];
  if (excludeId !== null) conditions.push(ne(accounts.id, excludeId));
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(...conditions))
    .limit(1);
  return rows.length > 0;
}

export async function earliestActivityDate(db: Executor, accountId: string): Promise<string | null> {
  const [row] = await db
    .select({ first: min(transactions.transactionDate) })
    .from(transactions)
    .where(or(eq(transactions.accountId, accountId), eq(transactions.destinationAccountId, accountId)));
  return row?.first ?? null;
}
