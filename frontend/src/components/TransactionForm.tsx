import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { ApiError } from "../api/client";
import { useCategories } from "../api/categories";
import { accraToday } from "../lib/dates";
import {
  entrySchema,
  toFormResult,
  type EntryFormValues,
  type FormKind,
  type FormResult,
} from "../schemas/transaction";
import { Button } from "./ui/Button";
import { DateField } from "./ui/DateField";
import { ErrorBanner } from "./ui/ErrorBanner";
import { MoneyField } from "./ui/MoneyField";
import { Segmented } from "./ui/Segmented";
import { Select } from "./ui/Select";
import { TextField } from "./ui/TextField";

export type AccountOption = { id: string; name: string };

type Props = {
  kind: FormKind;
  accounts: AccountOption[];
  defaultAccountId: string;
  initial?: Partial<EntryFormValues>;
  /** The entry being edited already has a linked fee (so a cleared fee must be sent as 0.00). */
  hadFee?: boolean;
  pending: boolean;
  error: unknown;
  submitLabel?: string;
  pendingLabel?: string;
  onSubmit: (result: FormResult) => void;
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Could not save. Check your connection and try again.";
}

const CHARGED_TO = [
  { value: "source", label: "From account" },
  { value: "destination", label: "To account" },
];

/**
 * One form for adding and editing income, expenses and transfers. A single form state means the
 * amount, date and name survive switching between the types.
 */
export function TransactionForm({
  kind,
  accounts,
  defaultAccountId,
  initial,
  hadFee = false,
  pending,
  error,
  submitLabel = "Save",
  pendingLabel = "Saving…",
  onSubmit,
}: Props) {
  const categoryType = kind === "income" ? "income" : "expense";
  const categories = useCategories(categoryType);
  const schema = useMemo(() => entrySchema(kind), [kind]);
  const [showDetails, setShowDetails] = useState(Boolean(initial?.description));
  const [showFee, setShowFee] = useState(Boolean(initial?.fee_amount));

  const firstOther = accounts.find((account) => account.id !== defaultAccountId)?.id ?? "";
  const {
    register,
    control,
    handleSubmit,
    setValue,
    getValues,
    formState: { errors },
  } = useForm<EntryFormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      amount: "",
      account_id: defaultAccountId,
      destination_account_id: firstOther,
      category_id: "",
      transaction_date: accraToday(),
      name: "",
      description: "",
      fee_amount: "",
      fee_account_id: "",
      fee_charged_to: "source",
      ...initial,
    },
  });

  // Categories are per type: clear the choice when the owner switches the entry type.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setValue("category_id", "");
  }, [kind, setValue]);

  // A saved category can only be shown once its option exists, so re-apply it after the list loads.
  const categoriesLoaded = Boolean(categories.data);
  useEffect(() => {
    if (categoriesLoaded) setValue("category_id", getValues("category_id"));
  }, [categoriesLoaded, getValues, setValue]);

  const submit = (values: EntryFormValues) => {
    if (pending) return;
    const nameOf = (id: string) => accounts.find((account) => account.id === id)?.name;
    onSubmit(
      toFormResult(
        values,
        kind,
        {
          category: categories.data?.find((item) => item.id === values.category_id)?.name,
          from: nameOf(values.account_id),
          to: nameOf(values.destination_account_id),
        },
        hadFee,
      ),
    );
  };

  const accountOptions = accounts.map((account) => (
    <option key={account.id} value={account.id}>
      {account.name}
    </option>
  ));

  return (
    <form onSubmit={handleSubmit(submit)} noValidate>
      <MoneyField label="Amount" autoFocus error={errors.amount?.message} {...register("amount")} />
      <Select
        label={kind === "transfer" ? "From" : "Account"}
        error={errors.account_id?.message}
        {...register("account_id")}
      >
        {accountOptions}
      </Select>
      {kind === "transfer" ? (
        <Select
          key="to"
          label="To"
          error={errors.destination_account_id?.message}
          {...register("destination_account_id")}
        >
          {accountOptions}
        </Select>
      ) : (
        // Distinct keys: without them React reuses one <select> for both fields and the form
        // library would write the cleared category into the "To" dropdown.
        <Select key="category" label="Category" error={errors.category_id?.message} {...register("category_id")}>
          <option value="">{kind === "expense" ? "Select a category" : "No category"}</option>
          {categories.data?.map((category) => (
            <option key={category.id} value={category.id}>
              {category.name}
            </option>
          ))}
        </Select>
      )}
      <DateField label="Date" error={errors.transaction_date?.message} {...register("transaction_date")} />
      <TextField
        label="Name"
        autoComplete="off"
        maxLength={120}
        placeholder={kind === "transfer" ? "Defaults to “From to To”" : "Defaults to the category"}
        error={errors.name?.message}
        {...register("name")}
      />

      {kind !== "income" ? (
        showFee ? (
          <div className="fee-section">
            <MoneyField label="Fee amount" error={errors.fee_amount?.message} {...register("fee_amount")} />
            {kind === "transfer" ? (
              <Controller
                control={control}
                name="fee_charged_to"
                render={({ field }) => (
                  <Segmented
                    label="Charged to"
                    value={field.value}
                    onChange={field.onChange}
                    options={CHARGED_TO}
                  />
                )}
              />
            ) : (
              <Select label="Fee account" {...register("fee_account_id")}>
                <option value="">Same account</option>
                {accountOptions}
              </Select>
            )}
          </div>
        ) : (
          <Button type="button" variant="plain" className="link-button" onClick={() => setShowFee(true)}>
            {kind === "transfer" ? "Add a fee" : "Sent to someone else? Add a fee"}
          </Button>
        )
      ) : null}

      {showDetails ? (
        <TextField
          label="Description"
          autoComplete="off"
          maxLength={500}
          error={errors.description?.message}
          {...register("description")}
        />
      ) : (
        <Button type="button" variant="plain" className="link-button" onClick={() => setShowDetails(true)}>
          Add details
        </Button>
      )}
      {error ? <ErrorBanner message={errorMessage(error)} /> : null}
      <div className="form-actions">
        <Button type="submit" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}
