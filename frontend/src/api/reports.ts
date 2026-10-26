import { useMutation } from "@tanstack/react-query";
import { api } from "./client";

export type TransactionCsvReportInput = {
  start_date: string;
  end_date: string;
};

export type TransactionCsvReportResult = { message: string };

export function useEmailTransactionCsv() {
  return useMutation({
    mutationFn: (input: TransactionCsvReportInput) =>
      api<TransactionCsvReportResult>("/reports/transactions-csv", {
        method: "POST",
        body: input,
      }),
  });
}
