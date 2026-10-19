import { Button } from "./Button";

type Props = { message: string; onRetry?: () => void; retryLabel?: string };

export function ErrorBanner({ message, onRetry, retryLabel = "Try again" }: Props) {
  return (
    <div className="error-banner" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <Button type="button" variant="plain" className="btn-outline" onClick={onRetry}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
