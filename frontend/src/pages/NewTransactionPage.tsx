import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { accraToday } from "../lib/dates";
import { useAccounts } from "../api/accounts";
import { useCreateEntry } from "../api/transactions";
import { useCreateTransfer } from "../api/transfers";
import { TransactionForm } from "../components/TransactionForm";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Segmented } from "../components/ui/Segmented";
import { Skeleton } from "../components/ui/Skeleton";
import { useLastAccount } from "../hooks/useLastAccount";
import type { FormKind, FormResult } from "../schemas/transaction";

const KINDS = [
  { value: "expense", label: "Expense" },
  { value: "income", label: "Income" },
  { value: "transfer", label: "Transfer" },
];

export function NewTransactionPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const accounts = useAccounts(false);
  const createEntry = useCreateEntry();
  const createTransfer = useCreateTransfer();
  const { lastAccountId, remember } = useLastAccount();
  const [kind, setKind] = useState<FormKind>("expense");

  if (accounts.isPending) return <Skeleton label="Loading accounts" lines={3} />;
  if (accounts.isError && !accounts.data) {
    return <ErrorBanner message="Could not load your accounts." onRetry={() => accounts.refetch()} />;
  }
  const list = accounts.data?.items ?? [];
  if (list.length === 0) {
    return (
      <EmptyState
        title="Add an account first"
        message="Entries are recorded against an account, such as your bank, mobile money or cash."
        action={
          <Link to="/accounts/new" className="btn btn-primary">
            Add an account
          </Link>
        }
      />
    );
  }
  const defaultAccountId = list.some((a) => a.id === lastAccountId) ? lastAccountId! : list[0].id;
  const mutation = kind === "transfer" ? createTransfer : createEntry;
  const requestedDate = searchParams.get("date");
  const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "") ? requestedDate! : accraToday();

  const done = (accountId: string) => {
    remember(accountId);
    // Calendar drill-in uses ?date=; return there so the owner keeps context.
    const returnTo = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate ?? "") ? "/calendar" : "/transactions";
    navigate(returnTo, { state: { saved: true } });
  };
  const save = (result: FormResult) => {
    if (result.kind === "transfer") {
      createTransfer.mutate(result.input, { onSuccess: () => done(result.input.source_account_id) });
    } else {
      createEntry.mutate(
        { kind: result.kind, input: result.input },
        { onSuccess: () => done(result.input.account_id) },
      );
    }
  };

  return (
    <section className="form-page">
      <h1>Add transaction</h1>
      <Segmented label="Entry type" value={kind} onChange={(v) => setKind(v as FormKind)} options={KINDS} />
      {kind === "transfer" && list.length < 2 ? (
        <EmptyState
          title="Add a second account to transfer between"
          message="A transfer moves money from one of your accounts to another."
          action={
            <Link to="/accounts/new" className="btn btn-primary">
              Add an account
            </Link>
          }
        />
      ) : (
        <TransactionForm
          kind={kind}
          accounts={list}
          defaultAccountId={defaultAccountId}
          initial={{ transaction_date: initialDate }}
          pending={mutation.isPending}
          error={mutation.error}
          onSubmit={save}
        />
      )}
    </section>
  );
}
