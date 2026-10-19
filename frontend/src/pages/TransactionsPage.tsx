import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAccounts } from "../api/accounts";
import { useCategories } from "../api/categories";
import { useTransactionList, type SortChoice, type TransactionFilters } from "../api/transactions";
import { TransactionRow } from "../components/TransactionRow";
import { Button } from "../components/ui/Button";
import { DateField } from "../components/ui/DateField";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Select } from "../components/ui/Select";
import { Sheet } from "../components/ui/Sheet";
import { Skeleton } from "../components/ui/Skeleton";
import { formatDate } from "../lib/dates";

type Applied = Omit<TransactionFilters, "q">;

const TYPE_LABELS = { income: "Income", expense: "Expense", transfer: "Transfer" } as const;
const SORT_OPTIONS: Array<{ value: SortChoice; label: string }> = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "highest", label: "Highest amount" },
  { value: "lowest", label: "Lowest amount" },
];

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

export function TransactionsPage() {
  const location = useLocation();
  const saved = Boolean((location.state as { saved?: boolean } | null)?.saved);
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [applied, setApplied] = useState<Applied>({});
  const [draft, setDraft] = useState<Applied>({});
  const [sheetOpen, setSheetOpen] = useState(false);

  const filters: TransactionFilters = { ...applied, q: q || undefined };
  const list = useTransactionList(filters);
  const categories = useCategories();
  const accounts = useAccounts(true);

  const items = list.data?.pages.flatMap((page) => page.items) ?? [];

  const chips: Array<{ key: keyof Applied; label: string }> = [];
  if (applied.start_date) chips.push({ key: "start_date", label: `From ${formatDate(applied.start_date)}` });
  if (applied.end_date) chips.push({ key: "end_date", label: `To ${formatDate(applied.end_date)}` });
  if (applied.type) chips.push({ key: "type", label: TYPE_LABELS[applied.type] });
  if (applied.category_id) {
    const name = categories.data?.find((c) => c.id === applied.category_id)?.name ?? "Category";
    chips.push({ key: "category_id", label: name });
  }
  if (applied.account_id) {
    const name = accounts.data?.items.find((a) => a.id === applied.account_id)?.name ?? "Account";
    chips.push({ key: "account_id", label: name });
  }
  const hasFilters = chips.length > 0 || q !== "";

  const clearAll = () => {
    setApplied({});
    setDraft({});
    setSearch("");
  };

  return (
    <section>
      <div className="page-header">
        <h1>Transactions</h1>
        <div className="page-header-actions">
          <Link to="/calendar" className="btn btn-outline">Calendar</Link>
          <Link to="/transactions/new" className="btn btn-primary desktop-only">
            Add transaction
          </Link>
        </div>
      </div>
      {saved ? (
        <p className="notice notice-success" role="status">
          Saved.
        </p>
      ) : null}

      <div className="search-row">
        <label htmlFor="tx-search" className="sr-only">
          Search transactions
        </label>
        <input
          id="tx-search"
          type="search"
          placeholder="Search by name"
          value={search}
          maxLength={120}
          autoComplete="off"
          onChange={(event) => setSearch(event.target.value)}
        />
        <Button
          type="button"
          variant="plain"
          className="btn-outline"
          onClick={() => {
            setDraft(applied);
            setSheetOpen(true);
          }}
        >
          {chips.length > 0 ? `Filters (${chips.length})` : "Filters"}
        </Button>
      </div>

      {chips.length > 0 ? (
        <ul className="chips" aria-label="Active filters">
          {chips.map((chip) => (
            <li key={chip.key} className="chip">
              <span>{chip.label}</span>
              <button
                type="button"
                aria-label={`Remove filter ${chip.label}`}
                onClick={() => setApplied((current) => ({ ...current, [chip.key]: undefined }))}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {list.isPending ? <Skeleton label="Loading transactions" lines={4} /> : null}
      {list.isError && !list.data ? (
        <ErrorBanner message="Could not load transactions." onRetry={() => list.refetch()} />
      ) : null}

      {list.data && items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            title="No matches"
            message="Nothing fits those filters."
            action={
              <Button type="button" onClick={clearAll}>
                Clear filters
              </Button>
            }
          />
        ) : (
          <EmptyState
            title="No transactions yet"
            message="Record your first income or expense."
            action={
              <Link to="/transactions/new" className="btn btn-primary">
                Add a transaction
              </Link>
            }
          />
        )
      ) : null}

      {items.length > 0 ? (
        <div className="card-list">
          {items.map((item) => (
            <TransactionRow key={item.id} transaction={item} />
          ))}
        </div>
      ) : null}
      {list.hasNextPage ? (
        <Button
          type="button"
          variant="plain"
          className="btn-outline load-more"
          disabled={list.isFetchingNextPage}
          onClick={() => list.fetchNextPage()}
        >
          {list.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}

      <Sheet open={sheetOpen} title="Filters" onClose={() => setSheetOpen(false)}>
        <div className="sheet-form">
          <DateField
            label="From"
            value={draft.start_date ?? ""}
            onChange={(event) => setDraft({ ...draft, start_date: event.target.value || undefined })}
          />
          <DateField
            label="To"
            value={draft.end_date ?? ""}
            onChange={(event) => setDraft({ ...draft, end_date: event.target.value || undefined })}
          />
          <Select
            label="Type"
            value={draft.type ?? ""}
            onChange={(event) =>
              setDraft({ ...draft, type: (event.target.value || undefined) as Applied["type"] })
            }
          >
            <option value="">All types</option>
            <option value="income">Income</option>
            <option value="expense">Expense</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Select
            label="Category"
            value={draft.category_id ?? ""}
            onChange={(event) => setDraft({ ...draft, category_id: event.target.value || undefined })}
          >
            <option value="">All categories</option>
            {categories.data?.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Select
            label="Account"
            value={draft.account_id ?? ""}
            onChange={(event) => setDraft({ ...draft, account_id: event.target.value || undefined })}
          >
            <option value="">All accounts</option>
            {accounts.data?.items.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
                {account.is_archived ? " (archived)" : ""}
              </option>
            ))}
          </Select>
          <Select
            label="Sort by"
            value={draft.sort ?? "newest"}
            onChange={(event) => setDraft({ ...draft, sort: event.target.value as SortChoice })}
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
          <div className="sheet-actions">
            <Button
              type="button"
              variant="plain"
              className="btn-outline"
              onClick={() => {
                setApplied({});
                setDraft({});
                setSheetOpen(false);
              }}
            >
              Clear all
            </Button>
            <Button
              type="button"
              onClick={() => {
                setApplied(draft);
                setSheetOpen(false);
              }}
            >
              Apply filters
            </Button>
          </div>
        </div>
      </Sheet>
    </section>
  );
}
