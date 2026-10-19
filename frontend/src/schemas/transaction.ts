import { z } from "zod";
import { isValidAmountInput, normalizeAmount } from "../lib/money";
import type { EntryInput } from "../api/transactions";
import type { TransferInput } from "../api/transfers";

export type FormKind = "income" | "expense" | "transfer";

const ZERO = /^0+(\.0+)?$/;

export function entrySchema(kind: FormKind) {
  return z
    .object({
      amount: z
        .string()
        .min(1, "Enter an amount")
        .refine(isValidAmountInput, "Enter a valid amount")
        .refine((value) => !ZERO.test(value), "Amount must be greater than zero"),
      account_id: z.string().min(1, "Choose an account"),
      destination_account_id: z.string(),
      category_id: z.string(),
      transaction_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
      name: z.string().trim().max(120, "Name is too long (120 characters at most)"),
      description: z.string().trim().max(500, "Description is too long (500 characters at most)"),
      fee_amount: z
        .string()
        .refine((value) => value === "" || isValidAmountInput(value), "Enter a valid amount"),
      fee_account_id: z.string(),
      fee_charged_to: z.enum(["source", "destination"]),
    })
    .superRefine((values, context) => {
      if (kind === "expense" && !values.category_id) {
        context.addIssue({ code: "custom", path: ["category_id"], message: "Choose a category" });
      }
      if (kind === "transfer") {
        if (!values.destination_account_id) {
          context.addIssue({
            code: "custom",
            path: ["destination_account_id"],
            message: "Choose an account",
          });
        } else if (values.destination_account_id === values.account_id) {
          context.addIssue({
            code: "custom",
            path: ["destination_account_id"],
            message: "Choose two different accounts",
          });
        }
      }
    });
}

export type EntryFormValues = z.infer<ReturnType<typeof entrySchema>>;

export type FormResult =
  | { kind: "income" | "expense"; input: EntryInput }
  | { kind: "transfer"; input: TransferInput };

type FeeFields = { fee_amount?: string; fee_account_id?: string };

/**
 * A non-zero fee is sent with its account. A blank or zero fee is omitted when creating, and sent as
 * "0.00" when editing something that had a fee, which removes the linked fee expense.
 */
function feeFields(values: EntryFormValues, kind: FormKind, hadFee: boolean): FeeFields {
  if (kind === "income") return {};
  const fee = values.fee_amount;
  if (fee !== "" && !ZERO.test(fee)) {
    const account =
      kind === "transfer"
        ? values.fee_charged_to === "destination"
          ? values.destination_account_id
          : values.account_id
        : values.fee_account_id || values.account_id;
    return { fee_amount: normalizeAmount(fee), fee_account_id: account };
  }
  return hadFee ? { fee_amount: "0.00" } : {};
}

type Names = { category?: string; from?: string; to?: string };

/** Form values to API input. A blank name falls back to the category, or "From to To" for transfers. */
export function toFormResult(
  values: EntryFormValues,
  kind: FormKind,
  names: Names,
  hadFee: boolean,
): FormResult {
  const base = {
    description: values.description.trim() || null,
    amount: normalizeAmount(values.amount),
    transaction_date: values.transaction_date,
    ...feeFields(values, kind, hadFee),
  };
  if (kind === "transfer") {
    return {
      kind,
      input: {
        ...base,
        name: values.name.trim() || `${names.from ?? "Source"} to ${names.to ?? "destination"}`,
        source_account_id: values.account_id,
        destination_account_id: values.destination_account_id,
      },
    };
  }
  const fallback = names.category ?? (kind === "income" ? "Income" : "Expense");
  return {
    kind,
    input: {
      ...base,
      name: values.name.trim() || fallback,
      account_id: values.account_id,
      category_id: values.category_id || null,
    },
  };
}
