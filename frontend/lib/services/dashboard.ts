import * as accounting from '../accounting';
import { getClock } from '../clock';
import { accraToday, addDays, DateValueError, daysBetween, formatMonth, monthOf, monthRange, parseMonth } from '../dates';
import { getDb } from '../db/client';
import { BusinessRuleError } from '../errors';
import { formatMoney } from '../money';
import { type AccountOut, listAccounts } from './account';
import { type BudgetSummary, getMonth } from './budget';
import { listTransactions } from './transaction';
import type { TransactionOut } from './transactionSupport';

const MAX_RANGE_DAYS = 1100; // about three years

function monthStart(month: string | null): string {
  try {
    return month ? parseMonth(month) : monthOf(accraToday(getClock().now()));
  } catch (error) {
    if (error instanceof DateValueError) throw new BusinessRuleError('validation_error', error.message);
    throw error;
  }
}

export interface DashboardSummary {
  month: string;
  currency: 'GHS';
  total_income: string;
  total_expenses: string;
  fee_total: string;
  net_cash_flow: string;
  budget: BudgetSummary;
  combined_balance: string;
  accounts: AccountOut[];
}

export async function summary(userId: string, month: string | null): Promise<DashboardSummary> {
  const db = getDb();
  const [start, end] = monthRange(monthStart(month));
  const totals = await accounting.periodTotals(db, userId, start, end);
  const accounts = await listAccounts(userId, false);
  return {
    month: formatMonth(start),
    currency: 'GHS',
    total_income: formatMoney(totals.income),
    total_expenses: formatMoney(totals.expenses),
    fee_total: formatMoney(totals.fees),
    net_cash_flow: formatMoney(accounting.netCashFlow(totals.income, totals.expenses)),
    budget: await getMonth(db, userId, start),
    combined_balance: accounts.combined_balance,
    accounts: accounts.items,
  };
}

export async function spendingByCategory(
  userId: string,
  month: string | null,
  startDate: string | null,
  endDate: string | null,
) {
  if ((startDate === null) !== (endDate === null)) {
    throw new BusinessRuleError('validation_error', 'Give both start_date and end_date, or neither.');
  }
  let start: string;
  let end: string;
  if (startDate !== null && endDate !== null) {
    if (month !== null) {
      throw new BusinessRuleError('validation_error', 'Use either month or a date range, not both.');
    }
    if (startDate > endDate) throw new BusinessRuleError('validation_error', 'The start date is after the end date.');
    [start, end] = [startDate, addDays(endDate, 1)];
  } else {
    [start, end] = monthRange(monthStart(month));
  }

  const db = getDb();
  const totals = await accounting.spendingByCategory(db, userId, start, end);
  const shares = accounting.sharePercentages(totals.map((t) => t.amount));
  return {
    total_expenses: formatMoney((await accounting.periodTotals(db, userId, start, end)).expenses),
    items: totals.map((t, i) => ({
      category_id: t.categoryId,
      name: t.name,
      amount: formatMoney(t.amount),
      share_percent: shares[i].toFixed(2),
    })),
  };
}

export async function cashFlow(userId: string, startDate: string, endDate: string, categoryId: string | null) {
  if (startDate > endDate) throw new BusinessRuleError('validation_error', 'The start date is after the end date.');
  if (daysBetween(startDate, endDate) + 1 > MAX_RANGE_DAYS) {
    throw new BusinessRuleError('validation_error', 'Choose a range of three years or less.');
  }
  const result = await accounting.cashFlow(getDb(), userId, startDate, endDate, categoryId);
  return {
    group_by: result.groupBy,
    income: formatMoney(result.income),
    expenses: formatMoney(result.expenses),
    net: formatMoney(result.net),
    buckets: result.buckets.map((b) => ({
      period: b.period,
      income: formatMoney(b.income),
      expenses: formatMoney(b.expenses),
    })),
  };
}

export async function transactionCalendar(userId: string, month: string | null) {
  const [start, end] = monthRange(monthStart(month));
  const days = await accounting.transactionCalendar(getDb(), userId, start, end);
  return {
    month: formatMonth(start),
    days: days.map((day) => ({
      date: day.date,
      income: formatMoney(day.income),
      expenses: formatMoney(day.expenses),
      net: formatMoney(day.net),
      transaction_count: day.transactionCount,
    })),
  };
}

export async function recentTransactions(userId: string, limit: number): Promise<{ items: TransactionOut[] }> {
  const page = await listTransactions(userId, {}, 'transaction_date', 'desc', 1, limit);
  return { items: page.items };
}
