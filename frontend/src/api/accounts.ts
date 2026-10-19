import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdempotentId } from "../hooks/useIdempotentId";
import { api } from "./client";
import { invalidateFinance, queryKeys } from "./queryKeys";

export type AccountType = "bank" | "mobile_money" | "cash";

export type Account = {
  id: string;
  name: string;
  account_type: AccountType;
  opening_balance: string;
  opening_date: string;
  is_archived: boolean;
  balance: string;
};

export type AccountList = { items: Account[]; combined_balance: string };

export type AccountInput = {
  name: string;
  account_type: AccountType;
  opening_balance: string;
  opening_date: string;
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  bank: "Bank",
  mobile_money: "Mobile money",
  cash: "Cash",
};

export function useAccounts(includeArchived = false) {
  return useQuery({
    queryKey: queryKeys.accounts.list(includeArchived),
    queryFn: () => api<AccountList>(`/accounts?include_archived=${includeArchived}`),
    placeholderData: keepPreviousData,
  });
}

export function useAccount(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.accounts.detail(id ?? ""),
    queryFn: () => api<Account>(`/accounts/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

/** The client id stays the same across retries of one form, so a retry cannot create a duplicate. */
export function useCreateAccount() {
  const queryClient = useQueryClient();
  const { id, reset } = useIdempotentId();
  return useMutation({
    mutationFn: (input: AccountInput) =>
      api<Account>("/accounts", { method: "POST", body: { id, ...input } }),
    onSuccess: async () => {
      reset();
      await invalidateFinance(queryClient);
    },
  });
}

export function useUpdateAccount(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: AccountInput) =>
      api<Account>(`/accounts/${accountId}`, { method: "PATCH", body: input }),
    onSuccess: () => invalidateFinance(queryClient),
  });
}

export function useArchiveAccount(accountId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<Account>(`/accounts/${accountId}/archive`, { method: "POST" }),
    onSuccess: () => invalidateFinance(queryClient),
  });
}
