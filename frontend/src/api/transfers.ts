import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useIdempotentId } from "../hooks/useIdempotentId";
import { api } from "./client";
import { invalidateFinance, queryKeys } from "./queryKeys";
import type { Transaction } from "./transactions";

export type TransferInput = {
  name: string;
  description: string | null;
  amount: string;
  transaction_date: string;
  source_account_id: string;
  destination_account_id: string;
  fee_amount?: string;
  fee_account_id?: string;
};

/** The client id is reused for every retry of one form, then renewed after a confirmed save. */
export function useCreateTransfer() {
  const queryClient = useQueryClient();
  const { id, reset } = useIdempotentId();
  return useMutation({
    mutationFn: (input: TransferInput) =>
      api<Transaction>("/transfers", { method: "POST", body: { id, ...input } }),
    onSuccess: async () => {
      reset();
      await invalidateFinance(queryClient);
    },
  });
}

export function useUpdateTransfer(transferId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ version, input }: { version: number; input: Partial<TransferInput> }) =>
      api<Transaction>(`/transfers/${transferId}`, { method: "PATCH", body: { version, ...input } }),
    onSuccess: () => invalidateFinance(queryClient),
  });
}

export function useDeleteTransfer(transferId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api<void>(`/transfers/${transferId}`, { method: "DELETE" }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: queryKeys.transactions.detail(transferId) });
      return invalidateFinance(queryClient);
    },
  });
}
