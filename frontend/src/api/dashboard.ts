import { useQuery } from "@tanstack/react-query";
import type { Account } from "./accounts";
import type { BudgetSummary } from "./budgets";
import { api } from "./client";
import { queryKeys } from "./queryKeys";
import type { Transaction } from "./transactions";

export type DashboardSummary = {
  month: string;
  currency: "GHS";
  total_income: string;
  total_expenses: string;
  fee_total: string;
  net_cash_flow: string;
  budget: BudgetSummary;
  combined_balance: string;
  accounts: Account[];
};

export type CategorySpend = {
  category_id: string | null;
  name: string;
  amount: string;
  share_percent: string;
};

export type SpendingByCategory = { total_expenses: string; items: CategorySpend[] };

export type CashFlowBucket = { period: string; income: string; expenses: string };

export type CashFlow = {
  group_by: "day" | "month";
  income: string;
  expenses: string;
  net: string;
  buckets: CashFlowBucket[];
};

export type CalendarDay = {
  date: string;
  income: string;
  expenses: string;
  net: string;
  transaction_count: number;
};

export type TransactionCalendar = { month: string; days: CalendarDay[] };

export function useDashboardSummary(month: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.summary(month),
    queryFn: () => api<DashboardSummary>(`/dashboard/summary?month=${month}`),
  });
}

export function useSpendingByCategory(month: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.spending({ month }),
    queryFn: () => api<SpendingByCategory>(`/dashboard/spending-by-category?month=${month}`),
  });
}

export function useCashFlow(startDate: string, endDate: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.cashFlow({ startDate, endDate }),
    queryFn: () =>
      api<CashFlow>(`/dashboard/cash-flow?start_date=${startDate}&end_date=${endDate}`),
  });
}

export function useRecentTransactions(limit = 10) {
  return useQuery({
    queryKey: queryKeys.dashboard.recent(limit),
    queryFn: async () =>
      (await api<{ items: Transaction[] }>(`/dashboard/recent-transactions?limit=${limit}`)).items,
  });
}

export function useTransactionCalendar(month: string) {
  return useQuery({
    queryKey: queryKeys.dashboard.calendar(month),
    queryFn: () => api<TransactionCalendar>(`/dashboard/calendar?month=${month}`),
  });
}
