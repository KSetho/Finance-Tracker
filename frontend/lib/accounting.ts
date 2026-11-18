/**
 * The single place that adds up money (port of backend/app/services/accounting.py).
 *
 * Balances, period totals, category totals and cash flow are all computed here, so the account,
 * budget, dashboard and history figures can never disagree. Services and routes call these
 * functions; nothing else sums money.
 */
import { and, asc, desc, eq, gte, inArray, lt, lte, ne, or, sql } from 'drizzle-orm';

import { addDays, addMonths, daysBetween } from './dates';
import type { Executor } from './db/client';
import { accounts, categories, transactions } from './db/schema';
import { type Decimal, dec, quantize, quantizeHalfUp, sum, ZERO } from './money';

const T = transactions;

const incomeSum = sql<string>`coalesce(sum(case when ${T.type} = 'income' then ${T.amount} else 0 end), 0)`;
const expenseSum = sql<string>`coalesce(sum(case when ${T.type} = 'expense' then ${T.amount} else 0 end), 0)`;
/** First day of a date's month, as an ISO string. */
const monthBucket = sql<string>`to_char(date_trunc('month', ${T.transactionDate}), 'YYYY-MM-DD')`;
const dayBucket = sql<string>`${T.transactionDate}::text`;

/** opening_balance + income - expenses (fees included) - transfers out + transfers in. */
export async function accountBalances(
  db: Executor,
  userId: string,
  accountIds: Iterable<string> | null = null,
): Promise<Map<string, Decimal>> {
  const ids = accountIds === null ? null : [...new Set(accountIds)];
  if (ids !== null && ids.length === 0) return new Map();

  const movement = sql`case
      when ${T.accountId} = ${accounts.id} and ${T.type} = 'income' then ${T.amount}
      when ${T.accountId} = ${accounts.id} and ${T.type} in ('expense', 'transfer') then -${T.amount}
      when ${T.destinationAccountId} = ${accounts.id} and ${T.type} = 'transfer' then ${T.amount}
      else 0 end`;
  const where =
    ids === null ? eq(accounts.userId, userId) : and(eq(accounts.userId, userId), inArray(accounts.id, ids));
  const rows = await db
    .select({
      id: accounts.id,
      balance: sql<string>`(${accounts.openingBalance} + coalesce(sum(${movement}), 0))::text`,
    })
    .from(accounts)
    .leftJoin(T, or(eq(T.accountId, accounts.id), eq(T.destinationAccountId, accounts.id)))
    .where(where)
    .groupBy(accounts.id, accounts.openingBalance);
  return new Map(rows.map((row) => [row.id, dec(row.balance)]));
}

/** Total of the balances of all active (not archived) accounts. */
export async function combinedBalance(db: Executor, userId: string): Promise<Decimal> {
  const active = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.isArchived, false)));
  const balances = await accountBalances(
    db,
    userId,
    active.map((row) => row.id),
  );
  return sum(balances.values());
}

export interface PeriodTotals {
  income: Decimal;
  /** Every expense row, linked fee expenses included. */
  expenses: Decimal;
  /** The linked fee expenses alone: a subset of `expenses`. */
  fees: Decimal;
}

/** Totals for transactions dated in [start, end). Transfers and opening balances are not
 * counted; a fee is counted once, through its own expense row, never through `fee_amount`. */
export async function periodTotals(db: Executor, userId: string, start: string, end: string): Promise<PeriodTotals> {
  const [row] = await db
    .select({
      income: sql<string>`${incomeSum}::text`,
      expenses: sql<string>`${expenseSum}::text`,
      fees: sql<string>`coalesce(sum(case when ${T.type} = 'expense' and ${T.relatedTransactionId} is not null then ${T.amount} else 0 end), 0)::text`,
    })
    .from(T)
    .where(and(eq(T.userId, userId), gte(T.transactionDate, start), lt(T.transactionDate, end)));
  return {
    income: quantize(row?.income ?? 0),
    expenses: quantize(row?.expenses ?? 0),
    fees: quantize(row?.fees ?? 0),
  };
}

/** Expenses per calendar month for [start, end), keyed by the first day of the month. */
export async function monthlyExpenses(
  db: Executor,
  userId: string,
  start: string,
  end: string,
): Promise<Map<string, Decimal>> {
  const rows = await db
    .select({ month: monthBucket, total: sql<string>`sum(${T.amount})::text` })
    .from(T)
    .where(and(eq(T.userId, userId), eq(T.type, 'expense'), gte(T.transactionDate, start), lt(T.transactionDate, end)))
    .groupBy(monthBucket);
  return new Map(rows.map((row) => [row.month, quantize(row.total)]));
}

/** Allowance minus spending; negative when over. Null when no allowance is set. */
export function allowanceRemaining(allowance: Decimal | null, spent: Decimal): Decimal | null {
  return allowance === null ? null : allowance.minus(spent);
}

/** Spending as a percentage of the allowance (two decimals); null when it is zero or unset. */
export function percentageUsed(allowance: Decimal | null, spent: Decimal): Decimal | null {
  if (allowance === null || allowance.lessThanOrEqualTo(0)) return null;
  return quantizeHalfUp(spent.dividedBy(allowance).times(100));
}

/** Income minus expenses. Transfers and opening balances are in neither. */
export function netCashFlow(income: Decimal, expenses: Decimal): Decimal {
  return income.minus(expenses);
}

export interface CategoryTotal {
  categoryId: string | null;
  name: string;
  amount: Decimal;
}

/** Expense rows only, grouped by category (a linked fee lands in Fees), for [start, end). */
export async function spendingByCategory(
  db: Executor,
  userId: string,
  start: string,
  end: string,
): Promise<CategoryTotal[]> {
  const total = sql`sum(${T.amount})`;
  const rows = await db
    .select({
      categoryId: categories.id,
      name: sql<string>`coalesce(${categories.name}, 'Uncategorized')`,
      amount: sql<string>`${total}::text`,
    })
    .from(T)
    .leftJoin(categories, eq(categories.id, T.categoryId))
    .where(and(eq(T.userId, userId), eq(T.type, 'expense'), gte(T.transactionDate, start), lt(T.transactionDate, end)))
    .groupBy(categories.id, categories.name)
    .orderBy(desc(total), asc(categories.name));
  return rows.map((row) => ({ categoryId: row.categoryId, name: row.name, amount: quantize(row.amount) }));
}

/** Each amount's share of the total as a two-decimal percentage; the shares add up to exactly
 * 100.00 (largest-remainder rounding). All zeros when the total is zero. */
export function sharePercentages(amounts: Decimal[]): Decimal[] {
  const total = sum(amounts);
  if (total.lessThanOrEqualTo(0)) return amounts.map(() => ZERO);
  const exact = amounts.map((amount) => amount.times(10000).dividedBy(total)); // hundredths of a percent
  const floors = exact.map((value) => value.truncated().toNumber());
  const leftover = 10000 - floors.reduce((a, b) => a + b, 0);
  const fractions = exact.map((value, i) => value.minus(floors[i]));
  const byFraction = exact
    .map((_, i) => i)
    .sort((a, b) => {
      const cmp = fractions[b].comparedTo(fractions[a]);
      return cmp !== 0 ? cmp : a - b;
    });
  for (const index of byFraction.slice(0, Math.max(0, leftover))) floors[index] += 1;
  return floors.map((value) => quantize(dec(value).dividedBy(100)));
}

export interface CashFlowBucket {
  /** YYYY-MM-DD for days, YYYY-MM for months. */
  period: string;
  income: Decimal;
  expenses: Decimal;
}

export interface CashFlowResult {
  groupBy: 'day' | 'month';
  income: Decimal;
  expenses: Decimal;
  net: Decimal;
  buckets: CashFlowBucket[];
}

export interface CalendarDay {
  date: string;
  income: Decimal;
  expenses: Decimal;
  net: Decimal;
  transactionCount: number;
}

/** Daily ledger activity for every date in [start, end).
 *
 * Transfers count as activity but contribute zero to income and expenses. Linked fee expense
 * rows count and contribute exactly once, like every other expense row. */
export async function transactionCalendar(
  db: Executor,
  userId: string,
  start: string,
  end: string,
): Promise<CalendarDay[]> {
  const rows = await db
    .select({
      day: dayBucket,
      income: sql<string>`${incomeSum}::text`,
      expenses: sql<string>`${expenseSum}::text`,
      count: sql<number>`count(${T.id})::int`,
    })
    .from(T)
    .where(and(eq(T.userId, userId), gte(T.transactionDate, start), lt(T.transactionDate, end)))
    .groupBy(T.transactionDate);
  const found = new Map(
    rows.map((row) => [row.day, [quantize(row.income), quantize(row.expenses), Number(row.count)] as const]),
  );

  const days: CalendarDay[] = [];
  for (let cursor = start; cursor < end; cursor = addDays(cursor, 1)) {
    const [income, expenses, count] = found.get(cursor) ?? [ZERO, ZERO, 0];
    days.push({ date: cursor, income, expenses, net: income.minus(expenses), transactionCount: count });
  }
  return days;
}

/** Income versus expenses between two dates (both inclusive). Ranges of up to 31 days are
 * grouped by day, longer ones by month; buckets with no activity are zero. */
export async function cashFlow(
  db: Executor,
  userId: string,
  first: string,
  last: string,
  categoryId: string | null = null,
): Promise<CashFlowResult> {
  const byDay = daysBetween(first, last) + 1 <= 31;
  const bucket = byDay ? dayBucket : monthBucket;
  const conditions = [
    eq(T.userId, userId),
    gte(T.transactionDate, first),
    lte(T.transactionDate, last),
    ne(T.type, 'transfer'),
  ];
  if (categoryId !== null) conditions.push(eq(T.categoryId, categoryId));
  const rows = await db
    .select({
      key: bucket,
      income: sql<string>`${incomeSum}::text`,
      expenses: sql<string>`${expenseSum}::text`,
    })
    .from(T)
    .where(and(...conditions))
    .groupBy(bucket);
  const found = new Map(rows.map((row) => [row.key, [quantize(row.income), quantize(row.expenses)] as const]));

  const keys: string[] = [];
  for (
    let cursor = byDay ? first : `${first.slice(0, 8)}01`;
    cursor <= last;
    cursor = byDay ? addDays(cursor, 1) : addMonths(cursor, 1)
  ) {
    keys.push(cursor);
  }

  const buckets: CashFlowBucket[] = keys.map((key) => {
    const [income, expenses] = found.get(key) ?? [ZERO, ZERO];
    return { period: byDay ? key : key.slice(0, 7), income, expenses };
  });
  const income = sum(buckets.map((b) => b.income));
  const expenses = sum(buckets.map((b) => b.expenses));
  return { groupBy: byDay ? 'day' : 'month', income, expenses, net: income.minus(expenses), buckets };
}
