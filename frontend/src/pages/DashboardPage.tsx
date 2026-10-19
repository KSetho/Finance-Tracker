import { Suspense, lazy, useState } from "react";
import { Link } from "react-router-dom";
import {
  useCashFlow,
  useDashboardSummary,
  useRecentTransactions,
  useSpendingByCategory,
  type DashboardSummary,
} from "../api/dashboard";
import { MonthPicker } from "../components/MonthPicker";
import { StatCard } from "../components/StatCard";
import { TransactionRow } from "../components/TransactionRow";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Segmented } from "../components/ui/Segmented";
import { Skeleton } from "../components/ui/Skeleton";
import { currentMonth, monthBounds, monthLabel, shiftMonth } from "../lib/dates";
import { formatGhs } from "../lib/money";

// Recharts is large; load it only when the dashboard is opened, so the rest of the app stays light.
const SpendingByCategoryChart = lazy(() =>
  import("../components/charts/SpendingByCategoryChart").then((m) => ({
    default: m.SpendingByCategoryChart,
  })),
);
const CashFlowChart = lazy(() =>
  import("../components/charts/CashFlowChart").then((m) => ({ default: m.CashFlowChart })),
);

const RANGES = [
  { value: "month", label: "Selected month" },
  { value: "three", label: "Last 3 months" },
];

function Headline({ data }: { data: DashboardSummary }) {
  return (
    <div role="group" aria-label="Month summary" className="stat-grid">
      <StatCard label="Income" value={formatGhs(data.total_income)} />
      <StatCard label="Expenses" value={formatGhs(data.total_expenses)} />
      <StatCard label="Fees" value={formatGhs(data.fee_total)} hint="Included in expenses" />
      <StatCard
        label="Net cash flow"
        value={formatGhs(data.net_cash_flow)}
        tone={data.net_cash_flow.startsWith("-") ? "negative" : "default"}
      />
    </div>
  );
}

function AllowanceCard({ budget }: { budget: DashboardSummary["budget"] }) {
  const over = budget.is_over_budget && budget.remaining !== null;
  return (
    <div role="group" aria-label="Allowance" className={over ? "stat-card stat-negative" : "stat-card"}>
      <p className="stat-label">Allowance remaining</p>
      {budget.remaining === null ? (
        <>
          <p className="stat-value">No allowance set</p>
          <Link to="/budget" className="text-link">
            Set an allowance
          </Link>
        </>
      ) : (
        <>
          <p className="stat-value">{formatGhs(budget.remaining)}</p>
          <p className="stat-hint">
            {over
              ? `Over by ${formatGhs(budget.remaining.slice(1))}`
              : budget.percentage_used === null
                ? "Allowance is zero"
                : `${budget.percentage_used}% of ${formatGhs(budget.allowance ?? "0.00")} used`}
          </p>
          <Link to="/budget" className="text-link">
            View budget
          </Link>
        </>
      )}
    </div>
  );
}

function Balances({ data }: { data: DashboardSummary }) {
  return (
    <>
      <StatCard label="Combined balance" value={formatGhs(data.combined_balance)} hint="Active accounts" />
      <ul className="balance-list" aria-label="Account balances">
        {data.accounts.map((account) => (
          <li key={account.id}>
            <Link to="/accounts">
              <span>{account.name}</span>
              <span>{formatGhs(account.balance)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

export function DashboardPage() {
  const [month, setMonth] = useState(currentMonth());
  const [range, setRange] = useState<"month" | "three">("month");

  const start = range === "month" ? monthBounds(month).start : monthBounds(shiftMonth(month, -2)).start;
  const end = monthBounds(month).end;

  const summary = useDashboardSummary(month);
  const spending = useSpendingByCategory(month);
  const cashFlow = useCashFlow(start, end);
  const recent = useRecentTransactions(10);

  const noSpending =
    month === currentMonth() ? "No spending this month" : `No spending in ${monthLabel(month)}`;

  return (
    <section>
      <h1>Dashboard</h1>
      <MonthPicker month={month} onChange={setMonth} />

      {summary.isPending ? <Skeleton label="Loading summary" lines={3} /> : null}
      {summary.isError ? (
        <ErrorBanner message="Could not load the summary." onRetry={() => summary.refetch()} />
      ) : null}
      {summary.data ? (
        <>
          <Headline data={summary.data} />
          <AllowanceCard budget={summary.data.budget} />
          <Balances data={summary.data} />
        </>
      ) : null}

      <h2 className="section-title">Spending by category</h2>
      {spending.isPending ? <Skeleton label="Loading spending" lines={2} /> : null}
      {spending.isError ? (
        <ErrorBanner message="Could not load spending by category." onRetry={() => spending.refetch()} />
      ) : null}
      {spending.data ? (
        spending.data.items.length === 0 ? (
          <EmptyState title={noSpending} />
        ) : (
          <Suspense fallback={<Skeleton label="Loading chart" lines={2} />}>
            <SpendingByCategoryChart items={spending.data.items} />
          </Suspense>
        )
      ) : null}

      <h2 className="section-title">Income and expenses</h2>
      <Segmented label="Period" value={range} onChange={(v) => setRange(v as "month" | "three")} options={RANGES} />
      {cashFlow.isPending ? <Skeleton label="Loading income and expenses" lines={2} /> : null}
      {cashFlow.isError ? (
        <ErrorBanner message="Could not load income and expenses." onRetry={() => cashFlow.refetch()} />
      ) : null}
      {cashFlow.data ? (
        cashFlow.data.income === "0.00" && cashFlow.data.expenses === "0.00" ? (
          <EmptyState title="No income or expenses in this period" />
        ) : (
          <Suspense fallback={<Skeleton label="Loading chart" lines={2} />}>
            <CashFlowChart cashFlow={cashFlow.data} />
          </Suspense>
        )
      ) : null}

      <div className="page-header section-title-row">
        <h2 className="section-title">Recent transactions</h2>
        <Link to="/transactions" className="text-link">
          See all
        </Link>
      </div>
      {recent.isPending ? <Skeleton label="Loading recent transactions" lines={3} /> : null}
      {recent.isError ? (
        <ErrorBanner message="Could not load recent transactions." onRetry={() => recent.refetch()} />
      ) : null}
      {recent.data ? (
        recent.data.length === 0 ? (
          <EmptyState title="No transactions yet" />
        ) : (
          <div className="card-list">
            {recent.data.map((item) => (
              <TransactionRow key={item.id} transaction={item} />
            ))}
          </div>
        )
      ) : null}
    </section>
  );
}
