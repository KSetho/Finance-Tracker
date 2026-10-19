import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { invalidateFinance, queryKeys } from "./queryKeys";

export type BudgetSummary = {
  month: string;
  allowance: string | null;
  total_expenses: string;
  remaining: string | null;
  percentage_used: string | null;
  is_over_budget: boolean;
};

const path = (month: string) => {
  const [year, mon] = month.split("-");
  return `/budgets/${year}/${Number(mon)}`;
};

export function useBudget(month: string) {
  return useQuery({
    queryKey: queryKeys.budgets.month(month),
    queryFn: () => api<BudgetSummary>(path(month)),
  });
}

export function useBudgetList() {
  return useQuery({
    queryKey: queryKeys.budgets.list,
    queryFn: async () => (await api<{ items: BudgetSummary[] }>("/budgets")).items,
  });
}

export function useSetAllowance(month: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (allowance: string) =>
      api<BudgetSummary>(path(month), { method: "PUT", body: { allowance } }),
    onSuccess: async (summary) => {
      queryClient.setQueryData(queryKeys.budgets.month(month), summary);
      await invalidateFinance(queryClient);
    },
  });
}
