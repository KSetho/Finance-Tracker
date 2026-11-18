import { and, asc, count as countRows, desc, eq, gte, inArray, lte, or, type SQL, sql } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { type NewTransaction, type Transaction, transactions, type TransactionType } from '../db/schema';

export interface TransactionFilters {
  startDate?: string | null;
  endDate?: string | null;
  type?: TransactionType | null;
  categoryId?: string | null;
  /** Matches the source or the destination account. */
  accountId?: string | null;
  /** Case-insensitive name search, matched literally. */
  q?: string | null;
}

export type SortBy = 'transaction_date' | 'amount';
export type SortOrder = 'asc' | 'desc';

export async function getOwned(
  db: Executor,
  userId: string,
  transactionId: string,
  forUpdate = false,
): Promise<Transaction | null> {
  const query = db
    .select()
    .from(transactions)
    .where(and(eq(transactions.id, transactionId), eq(transactions.userId, userId)));
  const [row] = forUpdate ? await query.for('update') : await query;
  return row ?? null;
}

export async function add(db: Executor, values: NewTransaction): Promise<Transaction> {
  const [row] = await db.insert(transactions).values(values).returning();
  return row;
}

/** Persist the mutable fields of a row the service has changed in memory. */
export async function save(db: Executor, row: Transaction): Promise<void> {
  await db
    .update(transactions)
    .set({
      name: row.name,
      description: row.description,
      amount: row.amount,
      transactionDate: row.transactionDate,
      accountId: row.accountId,
      destinationAccountId: row.destinationAccountId,
      categoryId: row.categoryId,
      feeAmount: row.feeAmount,
      version: row.version,
      updatedAt: row.updatedAt,
    })
    .where(eq(transactions.id, row.id));
}

export async function remove(db: Executor, row: Transaction): Promise<void> {
  await db.delete(transactions).where(eq(transactions.id, row.id));
}

/** The linked fee expense of each parent that has one, keyed by parent id. */
export async function feesForParents(db: Executor, parentIds: Iterable<string>): Promise<Map<string, Transaction>> {
  const ids = [...parentIds];
  if (ids.length === 0) return new Map();
  const rows = await db.select().from(transactions).where(inArray(transactions.relatedTransactionId, ids));
  const fees = new Map<string, Transaction>();
  for (const row of rows) {
    if (row.relatedTransactionId) fees.set(row.relatedTransactionId, row);
  }
  return fees;
}

function conditions(userId: string, filters: TransactionFilters): SQL[] {
  const result: SQL[] = [eq(transactions.userId, userId)];
  if (filters.startDate) result.push(gte(transactions.transactionDate, filters.startDate));
  if (filters.endDate) result.push(lte(transactions.transactionDate, filters.endDate));
  if (filters.type) result.push(eq(transactions.type, filters.type));
  if (filters.categoryId) result.push(eq(transactions.categoryId, filters.categoryId));
  if (filters.accountId) {
    result.push(
      or(eq(transactions.accountId, filters.accountId), eq(transactions.destinationAccountId, filters.accountId))!,
    );
  }
  if (filters.q) {
    const escaped = filters.q.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
    result.push(sql`${transactions.name} ILIKE ${`%${escaped}%`} ESCAPE '\\'`);
  }
  return result;
}

export async function listPage(
  db: Executor,
  userId: string,
  filters: TransactionFilters,
  sortBy: SortBy,
  sortOrder: SortOrder,
  page: number,
  pageSize: number,
): Promise<Transaction[]> {
  const direction = sortOrder === 'desc' ? desc : asc;
  const order =
    sortBy === 'amount'
      ? [direction(transactions.amount), desc(transactions.transactionDate), desc(transactions.createdAt)]
      : [direction(transactions.transactionDate), direction(transactions.createdAt), direction(transactions.id)];
  return db
    .select()
    .from(transactions)
    .where(and(...conditions(userId, filters)))
    .orderBy(...order)
    .limit(pageSize)
    .offset((page - 1) * pageSize);
}

/** Every matching row, oldest date first (for exports). */
export async function listAll(db: Executor, userId: string, filters: TransactionFilters): Promise<Transaction[]> {
  return db
    .select()
    .from(transactions)
    .where(and(...conditions(userId, filters)))
    .orderBy(asc(transactions.transactionDate), asc(transactions.createdAt), asc(transactions.id));
}

export async function count(db: Executor, userId: string, filters: TransactionFilters): Promise<number> {
  const [row] = await db
    .select({ value: countRows() })
    .from(transactions)
    .where(and(...conditions(userId, filters)));
  return row?.value ?? 0;
}
