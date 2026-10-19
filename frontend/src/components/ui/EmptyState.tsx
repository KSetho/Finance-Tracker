import type { ReactNode } from "react";

type Props = { title: string; message?: string; action?: ReactNode };

export function EmptyState({ title, message, action }: Props) {
  return (
    <div className="empty-state">
      <p className="empty-title">{title}</p>
      {message ? <p className="muted">{message}</p> : null}
      {action}
    </div>
  );
}
