import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { ApiError } from "../api/client";
import { useBudget, useBudgetList, useSetAllowance, type BudgetSummary } from "../api/budgets";
import { MonthPicker } from "../components/MonthPicker";
import { StatCard } from "../components/StatCard";
import { Button } from "../components/ui/Button";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { MoneyField } from "../components/ui/MoneyField";
import { Skeleton } from "../components/ui/Skeleton";
import { currentMonth, monthLabel } from "../lib/dates";
import { formatGhs, isValidAmountInput, normalizeAmount } from "../lib/money";

const schema = z.object({
  allowance: z
    .string()
    .min(1, "Enter an amount")
    .refine(isValidAmountInput, "Enter a valid amount"),
});
type Values = z.infer<typeof schema>;

const overBy = (remaining: string) => `Over by ${formatGhs(remaining.slice(1))}`;

function Figures({ month, budget }: { month: string; budget: BudgetSummary }) {
  const over = budget.is_over_budget && budget.remaining !== null;
  return (
    <div
      role="group"
      aria-label={month === currentMonth() ? "This month" : monthLabel(month)}
      className="stat-grid"
    >
      <StatCard
        label="Allowance"
        value={budget.allowance === null ? "No allowance set" : formatGhs(budget.allowance)}
      />
      <StatCard label="Spent" value={formatGhs(budget.total_expenses)} hint="Fees included, transfers not" />
      <StatCard
        label="Remaining"
        value={budget.remaining === null ? "—" : formatGhs(budget.remaining)}
        tone={over ? "negative" : "default"}
        hint={over ? overBy(budget.remaining!) : undefined}
      />
      <StatCard
        label="Used"
        value={budget.percentage_used === null ? "N/A" : `${budget.percentage_used}%`}
      />
    </div>
  );
}

function AllowanceForm({ month, allowance }: { month: string; allowance: string | null }) {
  const save = useSetAllowance(month);
  const [saved, setSaved] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<Values>({ resolver: zodResolver(schema), defaultValues: { allowance: allowance ?? "" } });

  const onSubmit = (values: Values) => {
    if (save.isPending) return;
    setSaved(false);
    save.mutate(normalizeAmount(values.allowance), { onSuccess: () => setSaved(true) });
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate className="allowance-form">
      <MoneyField label="Monthly allowance" error={errors.allowance?.message} {...register("allowance")} />
      {save.isError ? (
        <ErrorBanner
          message={
            save.error instanceof ApiError
              ? save.error.message
              : "Could not save the allowance. Try again."
          }
        />
      ) : null}
      {saved ? (
        <p className="notice notice-success" role="status" aria-label="Allowance saved">
          Allowance saved.
        </p>
      ) : null}
      <Button type="submit" disabled={save.isPending}>
        {save.isPending ? "Saving…" : "Save allowance"}
      </Button>
    </form>
  );
}

export function BudgetPage() {
  const [month, setMonth] = useState(currentMonth());
  const budget = useBudget(month);
  const recent = useBudgetList();
  const months = (recent.data ?? []).filter(
    (item) => item.allowance !== null || item.total_expenses !== "0.00",
  );

  return (
    <section>
      <h1>Monthly budget</h1>
      <MonthPicker month={month} onChange={setMonth} />

      {budget.isPending ? <Skeleton label="Loading budget" lines={3} /> : null}
      {budget.isError ? (
        <ErrorBanner message="Could not load the budget." onRetry={() => budget.refetch()} />
      ) : null}
      {budget.data ? (
        <>
          <Figures month={month} budget={budget.data} />
          <AllowanceForm key={month} month={month} allowance={budget.data.allowance} />
        </>
      ) : null}

      {months.length > 0 ? (
        <>
          <h2 className="section-title">Recent months</h2>
          <ul className="month-list" aria-label="Recent months">
            {months.map((item) => (
              <li key={item.month}>
                <button type="button" className="month-row" onClick={() => setMonth(item.month)}>
                  <span className="month-row-name">{monthLabel(item.month)}</span>
                  <span className="month-row-detail">
                    {formatGhs(item.total_expenses)} spent
                    {item.allowance !== null ? ` of ${formatGhs(item.allowance)}` : " · no allowance"}
                    {item.is_over_budget ? " · Over" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
