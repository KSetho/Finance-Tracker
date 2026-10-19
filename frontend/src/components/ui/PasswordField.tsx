import { forwardRef, useState, type InputHTMLAttributes } from "react";
import { TextField } from "./TextField";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  error?: string;
};

/** Password input with a Show/Hide toggle: typing a password on a phone keyboard is error-prone. */
export const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  props,
  ref,
) {
  const [visible, setVisible] = useState(false);
  return (
    <TextField
      {...props}
      ref={ref}
      type={visible ? "text" : "password"}
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      trailing={
        <button
          type="button"
          className="input-toggle"
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          {visible ? "Hide" : "Show"}
        </button>
      }
    />
  );
});
