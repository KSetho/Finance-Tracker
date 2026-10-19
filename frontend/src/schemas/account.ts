import { z } from "zod";
import { isValidAmountInput } from "../lib/money";

export const accountSchema = z.object({
  name: z.string().trim().min(1, "Enter a name").max(80, "Name is too long (80 characters at most)"),
  account_type: z.enum(["bank", "mobile_money", "cash"]),
  // Blank means 0.00. Typing is already limited to digits and two decimals by MoneyField.
  opening_balance: z
    .string()
    .refine((value) => value === "" || isValidAmountInput(value), "Enter a valid amount"),
  opening_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date"),
});

export type AccountFormValues = z.infer<typeof accountSchema>;
