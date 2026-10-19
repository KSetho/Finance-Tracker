import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useIdempotentId } from "../hooks/useIdempotentId";
import type { Category } from "./categories";
import { api } from "./client";
import { invalidateFinance, queryKeys } from "./queryKeys";

export type AccountRef = { id: string; name: string };

export type Transaction = {
  id: string;
  type: "income" | "expense" | "transfer";
  name: string;
  description: string | null;
  amount: string;
  transaction_date: string;
  account: AccountRef;
  destination_account: AccountRef | null;
  category: Category | null;
  fee_amount: string;
  fee: { id: string; amount: string; account: AccountRef } | null;
  is_fee: boolean;
  related_transaction_id: string | null;
  version: number;
};

export type EntryKind = "income" | "expense";

export type EntryInput = {
  name: string;
  description: string | null;
  amount: string;
  transaction_date: string;
  account_id: string;
  category_id: string | null;
  fee_amount?: string; // a payment to another person: becomes one linked fee expense
  fee_account_id?: string;
};

const ENDPOINT: Record<EntryKind, string> = { income: "income", expense: "expenses" };

/** The client id is reused for every retry of one form, then renewed after a confirmed save. */
export function useCreateEntry() {
  const queryClient = useQueryClient();
  const { id, reset } = useIdempotentId();
  return useMutation({
    mutationFn: ({ kind, input }: { kind: EntryKind; input: EntryInput }) =>
      api<Transaction>(`/transactions/${ENDPOINT[kind]}`, {
        method: "POST",
        body: { id, ...input },
      }),
    onSuccess: async () => {
      reset();
      await invalidateFinance(queryClient);
    },
  });
}

export type SortChoice = "newest" | "oldest" | "highest" | "lowest";

export type TransactionFilters = {
  q?: string;
  start_date?: string;
  end_date?: string;
  type?: "" | "income" | "expense" | "transfer";
  category_id?: string;
  account_id?: string;
  sort?: SortChoice;
};

export type TransactionPage = { items: Transaction[]; page: number; page_size: number; total: number };

export const PAGE_SIZE = 20;

const SORTS: Record<SortChoice, Record<string, string>> = {
  newest: {},
  oldest: { sort_by: "transaction_date", sort_order: "asc" },
  highest: { sort_by: "amount", sort_order: "desc" },
  lowest: { sort_by: "amount", sort_order: "asc" },
};

export function listQuery(filters: TransactionFilters, page: number): string {
  const params = new URLSearchParams();
  for (const key of ["q", "start_date", "end_date", "type", "category_id", "account_id"] as const) {
    const value = filters[key];
    if (value) params.set(key, value);
  }
  for (const [key, value] of Object.entries(SORTS[filters.sort ?? "newest"])) params.set(key, value);
  params.set("page", String(page));
  params.set("page_size", String(PAGE_SIZE));
  return params.toString();
}

export function useTransactionList(filters: TransactionFilters) {
  return useInfiniteQuery({
    queryKey: queryKeys.transactions.list(filters),
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api<TransactionPage>(`/transactions?${listQuery(filters, pageParam)}`),
    getNextPageParam: (last, all) => {
      const loaded = all.reduce((count, page) => count + page.items.length, 0);
      return loaded < last.total ? last.page + 1 : undefined;
    },
  });
}

export function useTransaction(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.transactions.detail(id ?? ""),
    queryFn: () => api<Transaction>(`/transactions/${id}`),
    enabled: Boolean(id),
    retry: false,
  });
}

export function useUpdateEntry(transactionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, input }: { version: number; input: Partial<EntryInput> }) =>
      api<Transaction>(`/transactions/${transactionId}`, {
        method: "PATCH",
        body: { version, ...input },
      }),
    onSuccess: () => invalidateFinance(queryClient),
  });
}

export function useDeleteTransaction(transactionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/transactions/${transactionId}`, { method: "DELETE" }),
    onSuccess: () => {
      // Drop the deleted entry's own query first so it is not refetched (and 404s) while we leave.
      queryClient.removeQueries({ queryKey: queryKeys.transactions.detail(transactionId) });
      return invalidateFinance(queryClient);
    },
  });
}
