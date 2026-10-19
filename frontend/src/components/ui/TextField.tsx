import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";

type Props = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  /** Control rendered inside the input box on the right (for example a show/hide toggle). */
  trailing?: ReactNode;
};

export const TextField = forwardRef<HTMLInputElement, Props>(function TextField(
  { label, error, trailing, ...rest },
  ref,
) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={trailing ? "input-wrap has-trailing" : "input-wrap"}>
        <input
          id={id}
          ref={ref}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          {...rest}
        />
        {trailing}
      </div>
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
});
