import { and, eq, gte, lte } from 'drizzle-orm';

import type { Executor } from '../db/client';
import { monthlyBudgets } from '../db/schema';
import { type Decimal, dec } from '../money';

export async function getForMonth(db: Executor, userId: string, monthStart: string): Promise<Decimal | null> {
  const [row] = await db
    .select({ allowance: monthlyBudgets.allowance })
    .from(monthlyBudgets)
    .where(and(eq(monthlyBudgets.userId, userId), eq(monthlyBudgets.monthStart, monthStart)))
    .limit(1);
  return row ? dec(row.allowance) : null;
}

/** One allowance per month: insert, or update the existing row (safe under concurrency). */
export async function upsert(
  db: Executor,
  userId: string,
  monthStart: string,
  allowance: Decimal,
  now: Date,
): Promise<void> {
  const value = allowance.toFixed(2);
  await db
    .insert(monthlyBudgets)
    .values({ id: crypto.randomUUID(), userId, monthStart, allowance: value, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: [monthlyBudgets.userId, monthlyBudgets.monthStart],
      set: { allowance: value, updatedAt: now },
    });
}

/** Allowances for months from `first` through `last` (both first-of-month dates). */
export async function allowancesBetween(
  db: Executor,
  userId: string,
  first: string,
  last: string,
): Promise<Map<string, Decimal>> {
  const rows = await db
    .select({ month: monthlyBudgets.monthStart, allowance: monthlyBudgets.allowance })
    .from(monthlyBudgets)
    .where(
      and(eq(monthlyBudgets.userId, userId), gte(monthlyBudgets.monthStart, first), lte(monthlyBudgets.monthStart, last)),
    );
  return new Map(rows.map((row) => [row.month, dec(row.allowance)]));
}
