import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { invalidateFinance } from "./queryKeys";

export type DataWipeRequestResult = { message: string };

export function useRequestDataWipe() {
  return useMutation({
    mutationFn: () =>
      api<DataWipeRequestResult>("/data-wipe/request", { method: "POST" }),
  });
}

export function useConfirmDataWipe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (code: string) =>
      api<void>("/data-wipe/confirm", { method: "POST", body: { code } }),
    onSuccess: async () => {
      queryClient.removeQueries({
        predicate: (query) => {
          const root = query.queryKey[0];
          return (
            root === "accounts" ||
            root === "transactions" ||
            root === "budgets" ||
            root === "dashboard" ||
            root === "categories"
          );
        },
      });
      await invalidateFinance(queryClient);
      await queryClient.invalidateQueries({ queryKey: ["categories"] });
    },
  });
}
