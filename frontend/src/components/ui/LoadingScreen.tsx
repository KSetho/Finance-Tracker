export function LoadingScreen({ label = "Checking your session…" }: { label?: string }) {
  return (
    <div className="loading-screen" role="status" aria-live="polite">
      {label}
    </div>
  );
}
