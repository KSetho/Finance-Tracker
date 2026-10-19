import { useState } from "react";
import { Link } from "react-router-dom";
import { useAccounts } from "../api/accounts";
import { AccountCard } from "../components/AccountCard";
import { StatCard } from "../components/StatCard";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Skeleton } from "../components/ui/Skeleton";
import { formatGhs } from "../lib/money";

export function AccountsPage() {
  const [showArchived, setShowArchived] = useState(false);
  const accounts = useAccounts(showArchived);

  return (
    <section>
      <div className="page-header">
        <h1>Accounts</h1>
        <Link to="/accounts/new" className="btn btn-primary">
          New account
        </Link>
      </div>

      {accounts.isPending ? <Skeleton label="Loading accounts" lines={3} /> : null}
      {accounts.isError && !accounts.data ? (
        <ErrorBanner message="Could not load accounts." onRetry={() => accounts.refetch()} />
      ) : null}

      {accounts.data ? (
        <>
          <StatCard
            label="Combined balance"
            value={formatGhs(accounts.data.combined_balance)}
            hint="Active accounts only"
            tone={accounts.data.combined_balance.startsWith("-") ? "negative" : "default"}
          />
          <label className="toggle">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(event) => setShowArchived(event.target.checked)}
            />
            Show archived
          </label>
          {accounts.data.items.length === 0 ? (
            <EmptyState
              title="No accounts yet"
              message="Add the places your money lives: bank, mobile money and cash."
              action={
                <Link to="/accounts/new" className="btn btn-primary">
                  Add your first account
                </Link>
              }
            />
          ) : (
            <div className="card-list">
              {accounts.data.items.map((account) => (
                <AccountCard key={account.id} account={account} />
              ))}
            </div>
          )}
        </>
      ) : null}
    </section>
  );
}
