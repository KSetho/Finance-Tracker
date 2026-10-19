import {
  forwardRef,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type InputHTMLAttributes,
} from "react";
import { CalendarGrid } from "../CalendarGrid";
import { accraToday, currentMonth } from "../../lib/dates";
import { MonthPicker } from "../MonthPicker";
import { Sheet } from "./Sheet";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & { label: string; error?: string };

/** Accessible sheet-based date picker. The submitted value remains `YYYY-MM-DD`. */
export const DateField = forwardRef<HTMLInputElement, Props>(function DateField(
  { label, error, min, max, value, defaultValue, onChange, name, disabled, ...props },
  forwardedRef,
) {
  const id = useId();
  const errorId = `${id}-error`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const initial = typeof value === "string" ? value : typeof defaultValue === "string" ? defaultValue : "";
  const [month, setMonth] = useState(initial ? initial.slice(0, 7) : currentMonth());

  const setRef = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  const select = (date: string) => {
    const input = inputRef.current;
    if (!input) return;
    input.value = date;
    onChange?.({ target: input, currentTarget: input } as ChangeEvent<HTMLInputElement>);
    setOpen(false);
  };

  return (
    <div className="field date-field">
      <label id={`${id}-label`} htmlFor={id}>
        {label}
      </label>
      <div className="date-input-row">
        <input
          {...props}
          ref={setRef}
          id={id}
          name={name}
          type="text"
          inputMode="numeric"
          placeholder="YYYY-MM-DD"
          pattern="\d{4}-\d{2}-\d{2}"
          value={value}
          defaultValue={defaultValue}
          minLength={10}
          maxLength={10}
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? "true" : undefined}
          disabled={disabled}
          onChange={onChange}
        />
        <button
          type="button"
          className="date-trigger"
          aria-label={`Open ${label} calendar`}
          disabled={disabled}
          onClick={() => {
            const date = inputRef.current?.value;
            setMonth(date ? date.slice(0, 7) : currentMonth());
            setOpen(true);
          }}
        >
          <span aria-hidden="true">▦</span>
        </button>
      </div>
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
      <Sheet open={open} title={`Choose ${label.toLowerCase()}`} onClose={() => setOpen(false)}>
        <MonthPicker month={month} onChange={setMonth} />
        <CalendarGrid
          month={month}
          selected={inputRef.current?.value}
          today={accraToday()}
          min={typeof min === "string" ? min : undefined}
          max={typeof max === "string" ? max : undefined}
          onSelect={select}
        />
      </Sheet>
    </div>
  );
});
