import { Link } from "react-router-dom";
import { useTransactionCalendar, type CalendarDay } from "../api/dashboard";
import { useTransactionList } from "../api/transactions";
import { CalendarGrid } from "../components/CalendarGrid";
import { MonthPicker } from "../components/MonthPicker";
import { TransactionRow } from "../components/TransactionRow";
import { Button } from "../components/ui/Button";
import { EmptyState } from "../components/ui/EmptyState";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { Sheet } from "../components/ui/Sheet";
import { Skeleton } from "../components/ui/Skeleton";
import { accraToday, currentMonth, formatDate } from "../lib/dates";
import { formatGhs } from "../lib/money";
import { useState } from "react";

function isZero(value: string | undefined): boolean {
  return !value || /^-?0+(\.0+)?$/.test(value);
}

function DaySummary({ day }: { day: CalendarDay }) {
  if (!day.transaction_count) return null;
  return (
    <span
      className="calendar-day-summary"
      aria-label={`${day.transaction_count} transactions, net ${formatGhs(day.net)}`}
    >
      {!isZero(day.income) ? <span className="calendar-income">+{formatGhs(day.income)}</span> : null}
      {!isZero(day.expenses) ? <span>−{formatGhs(day.expenses)}</span> : null}
      {isZero(day.income) && isZero(day.expenses) ? <span>Transfer</span> : null}
    </span>
  );
}

function DayDetails({ day, onClose }: { day: CalendarDay; onClose: () => void }) {
  const transactions = useTransactionList({ start_date: day.date, end_date: day.date });
  const items = transactions.data?.pages.flatMap((page) => page.items) ?? [];
  return (
    <Sheet open title={formatDate(day.date)} onClose={onClose}>
      <div className="calendar-day-totals">
        <span>Income <strong>{formatGhs(day.income)}</strong></span>
        <span>Expenses <strong>{formatGhs(day.expenses)}</strong></span>
        <span>Net <strong>{formatGhs(day.net)}</strong></span>
      </div>
      {transactions.isPending ? <Skeleton label="Loading transactions" lines={2} /> : null}
      {transactions.isError ? (
        <ErrorBanner message="Could not load this day." onRetry={() => transactions.refetch()} />
      ) : null}
      {items.length > 0 ? (
        <div className="card-list">
          {items.map((item) => <TransactionRow key={item.id} transaction={item} />)}
        </div>
      ) : null}
      {transactions.hasNextPage ? (
        <Button
          type="button"
          variant="plain"
          className="btn-outline load-more"
          disabled={transactions.isFetchingNextPage}
          onClick={() => transactions.fetchNextPage()}
        >
          {transactions.isFetchingNextPage ? "Loading…" : "Load more"}
        </Button>
      ) : null}
      {transactions.data && items.length === 0 ? (
        <EmptyState title="No transactions" message="Nothing was recorded on this day." />
      ) : null}
      <Link to={`/transactions/new?date=${day.date}`} className="btn btn-primary wide">
        Add transaction
      </Link>
    </Sheet>
  );
}

export function CalendarPage() {
  const [month, setMonth] = useState(currentMonth());
  const [selected, setSelected] = useState<CalendarDay | null>(null);
  const calendar = useTransactionCalendar(month);

  return (
    <section>
      <div className="page-header">
        <h1>Calendar</h1>
      </div>
      <MonthPicker month={month} onChange={(next) => { setMonth(next); setSelected(null); }} />
      {calendar.isPending ? <Skeleton label="Loading calendar" lines={5} /> : null}
      {calendar.isError ? (
        <ErrorBanner message="Could not load the calendar." onRetry={() => calendar.refetch()} />
      ) : null}
      {calendar.data ? (
        <CalendarGrid
          month={month}
          today={accraToday()}
          selected={selected?.date}
          days={calendar.data.days}
          onSelect={(date) =>
            setSelected(calendar.data.days.find((day) => day.date === date) ?? null)
          }
          renderSummary={(day) => <DaySummary day={day as CalendarDay} />}
        />
      ) : null}
      {selected ? <DayDetails day={selected} onClose={() => setSelected(null)} /> : null}
    </section>
  );
}
