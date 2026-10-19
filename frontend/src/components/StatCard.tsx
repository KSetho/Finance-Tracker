import type { ReactNode } from "react";

type Props = { label: string; value: string; hint?: ReactNode; tone?: "default" | "negative" };

export function StatCard({ label, value, hint, tone = "default" }: Props) {
  return (
    <div className={tone === "negative" ? "stat-card stat-negative" : "stat-card"}>
      <p className="stat-label">{label}</p>
      <p className="stat-value">{value}</p>
      {hint ? <p className="stat-hint">{hint}</p> : null}
    </div>
  );
}
