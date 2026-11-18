import * as accounting from '../accounting';
import { getClock } from '../clock';
import { accraToday, addMonths, DateValueError, formatMonth, monthOf, monthRange, parseMonth } from '../dates';
import { type Executor, getDb } from '../db/client';
import { BusinessRuleError } from '../errors';
import { type Decimal, formatMoney, formatMoneyOrNull, ZERO } from '../money';
import * as budgetRepository from '../repositories/budgets';

const DEFAULT_MONTHS = 12;
const MAX_MONTHS = 36;

export interface BudgetSummary {
  month: string;
  allowance: string | null;
  total_expenses: string;
  remaining: string | null;
  percentage_used: string | null;
  is_over_budget: boolean;
}

function summary(monthStart: string, allowance: Decimal | null, spent: Decimal): BudgetSummary {
  const remaining = accounting.allowanceRemaining(allowance, spent);
  const percentage = accounting.percentageUsed(allowance, spent);
  return {
    month: formatMonth(monthStart),
    allowance: formatMoneyOrNull(allowance),
    total_expenses: formatMoney(spent),
    remaining: formatMoneyOrNull(remaining),
    percentage_used: percentage === null ? null : percentage.toFixed(2),
    is_over_budget: remaining !== null && remaining.lessThan(0),
  };
}

export async function getMonth(db: Executor, userId: string, monthStart: string): Promise<BudgetSummary> {
  const [start, end] = monthRange(monthStart);
  const spent = (await accounting.periodTotals(db, userId, start, end)).expenses;
  return summary(start, await budgetRepository.getForMonth(db, userId, start), spent);
}

export async function setAllowance(userId: string, monthStart: string, allowance: Decimal): Promise<BudgetSummary> {
  const db = getDb();
  await budgetRepository.upsert(db, userId, monthOf(monthStart), allowance, getClock().now());
  console.info(`budget_set month=${formatMonth(monthStart)}`);
  return getMonth(db, userId, monthStart);
}

export async function listMonths(
  userId: string,
  first: string | null,
  last: string | null,
): Promise<{ items: BudgetSummary[] }> {
  let newest: string;
  let oldest: string;
  try {
    newest = last ? parseMonth(last) : monthOf(accraToday(getClock().now()));
    oldest = first ? parseMonth(first) : addMonths(newest, -(DEFAULT_MONTHS - 1));
  } catch (error) {
    if (error instanceof DateValueError) throw new BusinessRuleError('validation_error', error.message);
    throw error;
  }
  if (oldest > newest) throw new BusinessRuleError('validation_error', 'The start month is after the end month.');
  const count =
    (Number(newest.slice(0, 4)) - Number(oldest.slice(0, 4))) * 12 +
    Number(newest.slice(5, 7)) -
    Number(oldest.slice(5, 7)) +
    1;
  if (count > MAX_MONTHS) {
    throw new BusinessRuleError('validation_error', `Ask for at most ${MAX_MONTHS} months at a time.`);
  }

  const db = getDb();
  const allowances = await budgetRepository.allowancesBetween(db, userId, oldest, newest);
  const spent = await accounting.monthlyExpenses(db, userId, oldest, monthRange(newest)[1]);
  const items: BudgetSummary[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const month = addMonths(newest, -offset);
    items.push(summary(month, allowances.get(month) ?? null, spent.get(month) ?? ZERO));
  }
  return { items };
}
