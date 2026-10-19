import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  useAccount,
  useArchiveAccount,
  useCreateAccount,
  useUpdateAccount,
  type Account,
} from "../api/accounts";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { DateField } from "../components/ui/DateField";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { MoneyField } from "../components/ui/MoneyField";
import { Segmented } from "../components/ui/Segmented";
import { Skeleton } from "../components/ui/Skeleton";
import { TextField } from "../components/ui/TextField";
import { accraToday } from "../lib/dates";
import { formatGhs, normalizeAmount } from "../lib/money";
import { accountSchema, type AccountFormValues } from "../schemas/account";

const TYPE_OPTIONS = [
  { value: "bank", label: "Bank" },
  { value: "mobile_money", label: "Mobile money" },
  { value: "cash", label: "Cash" },
];

const isZero = (amount: string) => /^-?0+(\.0+)?$/.test(amount);

function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Could not save the account. Check your connection and try again.";
}

function AccountForm({ account }: { account?: Account }) {
  const navigate = useNavigate();
  const create = useCreateAccount();
  const update = useUpdateAccount(account?.id ?? "");
  const archive = useArchiveAccount(account?.id ?? "");
  const [confirmArchive, setConfirmArchive] = useState(false);
  const mutation = account ? update : create;

  const {
    register,
    control,
    handleSubmit,
    formState: { errors },
  } = useForm<AccountFormValues>({
    resolver: zodResolver(accountSchema),
    defaultValues: {
      name: account?.name ?? "",
      account_type: account?.account_type ?? "bank",
      opening_balance: account?.opening_balance ?? "",
      opening_date: account?.opening_date ?? accraToday(),
    },
  });

  const onSubmit = (values: AccountFormValues) => {
    if (mutation.isPending) return;
    mutation.mutate(
      {
        name: values.name.trim(),
        account_type: values.account_type,
        opening_balance: values.opening_balance === "" ? "0.00" : normalizeAmount(values.opening_balance),
        opening_date: values.opening_date,
      },
      { onSuccess: () => navigate("/accounts") },
    );
  };

  return (
    <section className="form-page">
      <Link to="/accounts" className="back-link">
        ← Accounts
      </Link>
      <h1>{account ? "Edit account" : "New account"}</h1>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <TextField
          label="Name"
          autoComplete="off"
          maxLength={80}
          error={errors.name?.message}
          {...register("name")}
        />
        <Controller
          control={control}
          name="account_type"
          render={({ field }) => (
            <Segmented
              label="Account type"
              value={field.value}
              onChange={field.onChange}
              options={TYPE_OPTIONS}
            />
          )}
        />
        <MoneyField
          label="Opening balance"
          error={errors.opening_balance?.message}
          {...register("opening_balance")}
        />
        <DateField label="Opening date" error={errors.opening_date?.message} {...register("opening_date")} />
        {mutation.isError ? <ErrorBanner message={errorMessage(mutation.error)} /> : null}
        <div className="form-actions">
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving…" : "Save account"}
          </Button>
        </div>
      </form>

      {account ? (
        <div className="danger-zone">
          <Button
            type="button"
            variant="plain"
            className="btn-outline btn-danger-outline"
            onClick={() => setConfirmArchive(true)}
          >
            Archive account
          </Button>
          <ConfirmDialog
            open={confirmArchive}
            title="Archive this account?"
            message={
              isZero(account.balance)
                ? "Its history stays, but it leaves your total and can no longer be chosen for new entries."
                : `This account still holds ${formatGhs(account.balance)}. Its history stays, but it leaves your total and can no longer be chosen for new entries.`
            }
            confirmLabel="Archive"
            pending={archive.isPending}
            onCancel={() => setConfirmArchive(false)}
            onConfirm={() =>
              archive.mutate(undefined, {
                onSuccess: () => navigate("/accounts"),
                onSettled: () => setConfirmArchive(false),
              })
            }
          />
          {archive.isError ? <ErrorBanner message="Could not archive the account. Try again." /> : null}
        </div>
      ) : null}
    </section>
  );
}

export function AccountFormPage() {
  const { id } = useParams();
  const account = useAccount(id);

  if (!id) return <AccountForm />;
  if (account.isPending) return <Skeleton label="Loading account" lines={3} />;
  if (account.isError) {
    const notFound = account.error instanceof ApiError && account.error.status === 404;
    return notFound ? (
      <EmptyState
        title="Account not found"
        action={
          <Link to="/accounts" className="btn btn-primary">
            Back to accounts
          </Link>
        }
      />
    ) : (
      <ErrorBanner message="Could not load the account." onRetry={() => account.refetch()} />
    );
  }
  return <AccountForm account={account.data} />;
}
