import { useId, useRef, type ReactNode } from "react";
import { useDialog } from "../../hooks/useDialog";

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode };

/** Bottom sheet on phones, centred panel on larger screens. Tap the backdrop or press Escape to close. */
export function Sheet({ open, title, onClose, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const onKeyDown = useDialog(ref, open, onClose);
  if (!open) return null;
  return (
    <>
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        className="sheet sheet-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="sheet-title">
          {title}
        </h2>
        {children}
      </div>
    </>
  );
}
