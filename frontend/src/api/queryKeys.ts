import type { QueryClient } from "@tanstack/react-query";

export const queryKeys = {
  accounts: {
    all: ["accounts"] as const,
    list: (includeArchived: boolean) => ["accounts", "list", { includeArchived }] as const,
    detail: (id: string) => ["accounts", "detail", id] as const,
  },
  categories: (type?: string) => ["categories", type ?? "all"] as const,
  transactions: {
    all: ["transactions"] as const,
    list: (filters: unknown) => ["transactions", "list", filters] as const,
    detail: (id: string) => ["transactions", "detail", id] as const,
  },
  budgets: {
    all: ["budgets"] as const,
    month: (month: string) => ["budgets", "month", month] as const,
    list: ["budgets", "list"] as const,
  },
  dashboard: {
    all: ["dashboard"] as const,
    summary: (month: string) => ["dashboard", "summary", month] as const,
    spending: (params: unknown) => ["dashboard", "spending", params] as const,
    cashFlow: (params: unknown) => ["dashboard", "cash-flow", params] as const,
    recent: (limit: number) => ["dashboard", "recent", limit] as const,
    calendar: (month: string) => ["dashboard", "calendar", month] as const,
  },
};

/** After any confirmed change to money data, everything derived from it is stale. */
export function invalidateFinance(queryClient: QueryClient): Promise<unknown> {
  return Promise.all(
    [queryKeys.accounts.all, queryKeys.transactions.all, queryKeys.budgets.all, queryKeys.dashboard.all].map(
      (queryKey) => queryClient.invalidateQueries({ queryKey }),
    ),
  );
}
