import { useEffect, useState } from "react";

const TEXT_ENTRY =
  "textarea, select, input:not([type=button]):not([type=submit]):not([type=checkbox]):not([type=radio])";

/**
 * True while a text-entry control has focus. On phones the on-screen keyboard is then open, and a
 * fixed bottom bar would eat a large part of the remaining viewport, so the layout hides it.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) =>
      setOpen(event.target instanceof Element && event.target.matches(TEXT_ENTRY));
    const onFocusOut = () => setOpen(false);
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);
    return () => {
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
    };
  }, []);
  return open;
}
