import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { daysInMonth, mondayIndex, shiftDate } from "../lib/dates";

export type CalendarDayData = {
  date: string;
  income?: string;
  expenses?: string;
  net?: string;
  transaction_count?: number;
};

type Props = {
  month: string;
  selected?: string;
  today?: string;
  days?: CalendarDayData[];
  min?: string;
  max?: string;
  onSelect: (date: string) => void;
  renderSummary?: (day: CalendarDayData) => ReactNode;
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarGrid({
  month,
  selected,
  today,
  days,
  min,
  max,
  onSelect,
  renderSummary,
}: Props) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({});
  const byDate = new Map(days?.map((day) => [day.date, day]));
  const count = daysInMonth(month);
  const offset = mondayIndex(`${month}-01`);
  const cells: Array<CalendarDayData | null> = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: count }, (_, index) => {
      const date = `${month}-${String(index + 1).padStart(2, "0")}`;
      return byDate.get(date) ?? { date };
    }),
  ];
  while (cells.length % 7) cells.push(null);

  const move = (event: KeyboardEvent<HTMLButtonElement>, date: string) => {
    const delta =
      event.key === "ArrowLeft"
        ? -1
        : event.key === "ArrowRight"
          ? 1
          : event.key === "ArrowUp"
            ? -7
            : event.key === "ArrowDown"
              ? 7
              : 0;
    if (!delta) return;
    event.preventDefault();
    const target = shiftDate(date, delta);
    refs.current[target]?.focus();
  };

  return (
    <div className="calendar" role="grid" aria-label={`Calendar for ${month}`}>
      <div className="calendar-weekdays" role="row">
        {WEEKDAYS.map((day) => (
          <span role="columnheader" key={day}>
            {day}
          </span>
        ))}
      </div>
      <div className="calendar-days">
        {cells.map((day, index) =>
          day ? (
            <button
              key={day.date}
              ref={(node) => {
                refs.current[day.date] = node;
              }}
              type="button"
              role="gridcell"
              className={[
                "calendar-day",
                day.date === selected ? "is-selected" : "",
                day.date === today ? "is-today" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              aria-selected={day.date === selected}
              aria-current={day.date === today ? "date" : undefined}
              disabled={(min != null && day.date < min) || (max != null && day.date > max)}
              onKeyDown={(event) => move(event, day.date)}
              onClick={() => onSelect(day.date)}
            >
              <span className="calendar-day-number">{Number(day.date.slice(-2))}</span>
              {renderSummary?.(day)}
            </button>
          ) : (
            <span key={`empty-${index}`} className="calendar-day is-empty" aria-hidden="true" />
          ),
        )}
      </div>
    </div>
  );
}
