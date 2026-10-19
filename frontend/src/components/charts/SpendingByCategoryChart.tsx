import { Bar, BarChart, ResponsiveContainer, XAxis, YAxis } from "recharts";
import type { CategorySpend } from "../../api/dashboard";
import { formatGhs } from "../../lib/money";

/**
 * Horizontal bars (long category names fit a phone) with the same numbers as plain text beneath, so
 * nothing depends on hovering. Number() is used only to size the bars, never for a displayed amount.
 */
export function SpendingByCategoryChart({ items }: { items: CategorySpend[] }) {
  const data = items.map((item) => ({ name: item.name, value: Number(item.amount) }));
  return (
    <div>
      <div
        role="img"
        aria-label="Spending by category chart"
        className="chart"
        style={{ height: Math.max(120, items.length * 38 + 16) }}
      >
        <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 320, height: 160 }}>
          <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <XAxis type="number" hide />
            <YAxis
              type="category"
              dataKey="name"
              width={88}
              tick={{ fontSize: 12 }}
              axisLine={false}
              tickLine={false}
            />
            <Bar dataKey="value" fill="#0b6b4f" radius={[0, 6, 6, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ul className="legend-list" aria-label="Spending by category">
        {items.map((item) => (
          <li key={item.category_id ?? item.name}>
            <span className="legend-name">{item.name}</span>
            <span className="legend-amount">{formatGhs(item.amount)}</span>
            <span className="legend-share">{item.share_percent}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
