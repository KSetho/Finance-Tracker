import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { CashFlow } from "../../api/dashboard";
import { formatGhs } from "../../lib/money";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function tickLabel(period: string): string {
  const parts = period.split("-");
  return parts.length === 3 ? String(Number(parts[2])) : MONTHS[Number(parts[1]) - 1];
}

/** Income against expenses per day or month, with the totals written out in full beside it. */
export function CashFlowChart({ cashFlow }: { cashFlow: CashFlow }) {
  const data = cashFlow.buckets.map((bucket) => ({
    label: tickLabel(bucket.period),
    Income: Number(bucket.income),
    Expenses: Number(bucket.expenses),
  }));
  return (
    <div>
      <ul role="group" aria-label="Income and expenses totals" className="amount-lines">
        <li>
          <span>Income</span>
          <span>{formatGhs(cashFlow.income)}</span>
        </li>
        <li>
          <span>Expenses</span>
          <span>{formatGhs(cashFlow.expenses)}</span>
        </li>
        <li>
          <span>Net</span>
          <span className={cashFlow.net.startsWith("-") ? "text-negative" : undefined}>
            {formatGhs(cashFlow.net)}
          </span>
        </li>
      </ul>
      <div role="img" aria-label="Income and expenses chart" className="chart" style={{ height: 200 }}>
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 200 }}>
          <BarChart data={data} barGap={0} barCategoryGap={1} margin={{ top: 8, right: 4, bottom: 0, left: 0 }}>
            <XAxis
              dataKey="label"
              tick={{ fontSize: 12 }}
              interval="preserveStartEnd"
              axisLine={false}
              tickLine={false}
            />
            <YAxis hide />
            <Bar dataKey="Income" fill="#0b6b4f" isAnimationActive={false} />
            <Bar dataKey="Expenses" fill="#c2410c" isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <p className="chart-legend">
        <span className="swatch swatch-income" aria-hidden="true" /> Income
        <span className="swatch swatch-expense" aria-hidden="true" /> Expenses
        <span className="muted"> · by {cashFlow.group_by}</span>
      </p>
    </div>
  );
}
