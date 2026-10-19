import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAccounts } from "../api/accounts";
import { ApiError } from "../api/client";
import {
  useDeleteTransaction,
  useTransaction,
  useUpdateEntry,
  type Transaction,
} from "../api/transactions";
import { useDeleteTransfer, useUpdateTransfer } from "../api/transfers";
import { TransactionForm, type AccountOption } from "../components/TransactionForm";
import { displayName, signedAmount } from "../components/TransactionRow";
import { Button } from "../components/ui/Button";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Skeleton } from "../components/ui/Skeleton";
import { formatDate } from "../lib/dates";
import { formatGhs } from "../lib/money";
import type { EntryFormValues, FormKind, FormResult } from "../schemas/transaction";

const TYPE_LABEL = { income: "Income", expense: "Expense", transfer: "Transfer" } as const;

function initialValues(t: Transaction): Partial<EntryFormValues> {
  const feeAmount = t.fee && t.fee.amount !== "0.00" ? t.fee.amount : "";
  return {
    amount: t.amount,
    account_id: t.account.id,
    destination_account_id: t.destination_account?.id ?? "",
    category_id: t.category?.id ?? "",
    transaction_date: t.transaction_date,
    name: t.name,
    description: t.description ?? "",
    fee_amount: feeAmount,
    fee_account_id: t.type === "expense" ? (t.fee?.account.id ?? "") : "",
    fee_charged_to: t.fee && t.fee.account.id === t.destination_account?.id ? "destination" : "source",
  };
}

function Detail({ transaction }: { transaction: Transaction }) {
  const navigate = useNavigate();
  const reload = useTransaction(transaction.id);
  const accounts = useAccounts(false);
  const updateEntry = useUpdateEntry(transaction.id);
  const updateTransfer = useUpdateTransfer(transaction.id);
  const deleteEntry = useDeleteTransaction(transaction.id);
  const deleteTransfer = useDeleteTransfer(transaction.id);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isTransfer = transaction.type === "transfer";
  const update = isTransfer ? updateTransfer : updateEntry;
  const remove = isTransfer ? deleteTransfer : deleteEntry;
  const stale = update.error instanceof ApiError && update.error.code === "stale_version";
  const isFee = transaction.is_fee;
  const hasFee = transaction.fee !== null;

  // Active accounts, plus this entry's own accounts if they have since been archived.
  const options: AccountOption[] = (accounts.data?.items ?? []).map((a) => ({ id: a.id, name: a.name }));
  for (const own of [transaction.account, transaction.destination_account]) {
    if (own && !options.some((option) => option.id === own.id)) {
      options.push({ id: own.id, name: `${own.name} (archived)` });
    }
  }

  const save = (result: FormResult) => {
    const onSuccess = { onSuccess: () => navigate("/transactions") };
    if (result.kind === "transfer") {
      updateTransfer.mutate({ version: transaction.version, input: result.input }, onSuccess);
    } else {
      updateEntry.mutate({ version: transaction.version, input: result.input }, onSuccess);
    }
  };

  return (
    <section className="form-page">
      <Link to="/transactions" className="back-link">
        ← Transactions
      </Link>
      <h1>{displayName(transaction)}</h1>
      <p className={`detail-amount tx-${transaction.type}`}>{signedAmount(transaction)}</p>

      {isFee ? (
        <div className="notice">
          <p>This fee is managed by its transfer or payment. Change or delete that instead.</p>
          {transaction.related_transaction_id ? (
            <Link to={`/transactions/${transaction.related_transaction_id}`} className="text-link">
              View the transfer or payment
            </Link>
          ) : null}
        </div>
      ) : null}

      {editing ? (
        <>
          {stale ? (
            <ErrorBanner
              message="This entry changed on another device. Reload it and try again."
              retryLabel="Reload"
              onRetry={() => {
                update.reset();
                setEditing(false);
                void reload.refetch();
              }}
            />
          ) : null}
          <TransactionForm
            kind={transaction.type as FormKind}
            accounts={options}
            defaultAccountId={transaction.account.id}
            initial={initialValues(transaction)}
            hadFee={hasFee}
            submitLabel="Save changes"
            pending={update.isPending}
            error={stale ? null : update.error}
            onSubmit={save}
          />
          <Button type="button" variant="plain" className="btn-outline wide" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        </>
      ) : (
        <>
          {isTransfer || hasFee ? (
            <ul className="amount-lines" aria-label="Amounts">
              <li>
                <span>Amount</span>
                <span>{formatGhs(transaction.amount)}</span>
              </li>
              {transaction.fee ? (
                <li>
                  <span>Fee</span>
                  <span>
                    {formatGhs(transaction.fee.amount)} · charged to {transaction.fee.account.name}
                  </span>
                </li>
              ) : null}
            </ul>
          ) : null}
          <dl className="detail-list">
            <dt>Type</dt>
            <dd>{isFee ? "Fee" : TYPE_LABEL[transaction.type]}</dd>
            <dt>Date</dt>
            <dd>{formatDate(transaction.transaction_date)}</dd>
            {isTransfer && transaction.destination_account ? (
              <>
                <dt>Accounts</dt>
                <dd>{`${transaction.account.name} → ${transaction.destination_account.name}`}</dd>
              </>
            ) : (
              <>
                <dt>Account</dt>
                <dd>{transaction.account.name}</dd>
              </>
            )}
            {transaction.category ? (
              <>
                <dt>Category</dt>
                <dd>{transaction.category.name}</dd>
              </>
            ) : null}
            {transaction.description ? (
              <>
                <dt>Description</dt>
                <dd>{transaction.description}</dd>
              </>
            ) : null}
          </dl>
          {remove.isError ? <ErrorBanner message="Could not delete the entry. Try again." /> : null}
          {!isFee ? (
            <div className="detail-actions">
              <Button type="button" onClick={() => setEditing(true)}>
                Edit
              </Button>
              <Button
                type="button"
                variant="plain"
                className="btn-outline btn-danger-outline"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            </div>
          ) : null}
          <ConfirmDialog
            open={confirmDelete}
            title="Delete this entry?"
            message={
              hasFee
                ? "It is removed from your balances and reports, and its fee is removed too. This cannot be undone."
                : "It is removed from your balances and reports. This cannot be undone."
            }
            confirmLabel="Delete"
            pending={remove.isPending}
            onCancel={() => setConfirmDelete(false)}
            onConfirm={() =>
              remove.mutate(undefined, {
                onSuccess: () => navigate("/transactions"),
                onSettled: () => setConfirmDelete(false),
              })
            }
          />
        </>
      )}
    </section>
  );
}

export function TransactionDetailPage() {
  const { id } = useParams();
  const transaction = useTransaction(id);

  if (transaction.isPending) return <Skeleton label="Loading transaction" lines={3} />;
  if (transaction.isError) {
    const notFound = transaction.error instanceof ApiError && transaction.error.status === 404;
    return notFound ? (
      <EmptyState
        title="Transaction not found"
        action={
          <Link to="/transactions" className="btn btn-primary">
            Back to transactions
          </Link>
        }
      />
    ) : (
      <ErrorBanner message="Could not load the transaction." onRetry={() => transaction.refetch()} />
    );
  }
  return <Detail transaction={transaction.data} />;
}
