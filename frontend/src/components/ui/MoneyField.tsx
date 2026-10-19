import { forwardRef, type InputHTMLAttributes } from "react";
import { sanitizeAmountTyping } from "../../lib/money";
import { TextField } from "./TextField";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "inputMode"> & {
  label: string;
  error?: string;
};

/** Amount input: decimal keypad on phones, and only digits and one dot with two decimals. */
export const MoneyField = forwardRef<HTMLInputElement, Props>(function MoneyField(
  { onInput, ...props },
  ref,
) {
  return (
    <TextField
      placeholder="0.00"
      {...props}
      ref={ref}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      onInput={(event) => {
        const input = event.currentTarget;
        const clean = sanitizeAmountTyping(input.value);
        if (clean !== input.value) input.value = clean;
        onInput?.(event);
      }}
    />
  );
});
