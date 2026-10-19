import { Navigate, Outlet, useLocation } from "react-router-dom";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { LoadingScreen } from "../components/ui/LoadingScreen";
import { useAuth, useRetrySession } from "./AuthProvider";

export function RequireAuth() {
  const auth = useAuth();
  const location = useLocation();
  const retry = useRetrySession();

  if (auth.status === "loading") return <LoadingScreen />;
  if (auth.status === "error") {
    return (
      <main className="content" style={{ padding: "1.5rem 1rem" }}>
        <ErrorBanner
          message="Could not verify your session. Check your connection and try again."
          onRetry={retry}
        />
      </main>
    );
  }
  if (auth.status === "unauthenticated") {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return <Outlet />;
}
