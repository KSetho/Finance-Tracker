import { monthLabel, shiftMonth } from "../lib/dates";

type Props = { month: string; onChange: (month: string) => void };

/** Previous / next month with the current one in between. Large targets, announced on change. */
export function MonthPicker({ month, onChange }: Props) {
  return (
    <div className="month-picker">
      <button type="button" aria-label="Previous month" onClick={() => onChange(shiftMonth(month, -1))}>
        <span aria-hidden="true">‹</span>
      </button>
      <p data-testid="month-label" aria-live="polite">
        {monthLabel(month)}
      </p>
      <button type="button" aria-label="Next month" onClick={() => onChange(shiftMonth(month, 1))}>
        <span aria-hidden="true">›</span>
      </button>
    </div>
  );
}
