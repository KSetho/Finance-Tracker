import { useEffect, useId, useRef, useState } from "react";
import { useDialog } from "../../hooks/useDialog";
import { Button } from "./Button";

type Props = {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = "Cancel",
  destructive = true,
  pending = false,
  onConfirm,
  onCancel,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const [submitted, setSubmitted] = useState(false);
  const wasPending = useRef(false);
  const onKeyDown = useDialog(ref, open, onCancel);

  // Allow another attempt once a pending request has finished (for example after an error).
  useEffect(() => {
    if (wasPending.current && !pending) setSubmitted(false);
    wasPending.current = pending;
  }, [pending]);
  useEffect(() => {
    if (!open) setSubmitted(false);
  }, [open]);

  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" aria-hidden="true" />
      <div
        ref={ref}
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        {message ? <p className="muted">{message}</p> : null}
        <div className="dialog-actions">
          <Button type="button" variant="plain" className="btn-outline" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            className={destructive ? "btn-danger" : undefined}
            disabled={pending}
            onClick={() => {
              if (submitted) return;
              setSubmitted(true);
              onConfirm();
            }}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </>
  );
}
