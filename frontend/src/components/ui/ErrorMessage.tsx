export function ErrorMessage({ children }: { children: string }) {
  return (
    <p className="error-message" role="alert">
      {children}
    </p>
  );
}
