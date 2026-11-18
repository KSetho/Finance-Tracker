"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { LoadingScreen } from "../components/ui/LoadingScreen";
import { useAuth, useRetrySession } from "./AuthProvider";

export function RequireAuth({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const retry = useRetrySession();
  const unauthenticated = auth.status === "unauthenticated";

  useEffect(() => {
    if (unauthenticated) router.replace(`/login?from=${encodeURIComponent(pathname)}`);
  }, [unauthenticated, pathname, router]);

  if (auth.status === "loading" || unauthenticated) return <LoadingScreen />;
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
  return <>{children}</>;
}
