import { useQueryClient } from "@tanstack/react-query";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { clearSession, ME_KEY, useMe, type Owner } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";

type AuthState = { sessionExpired: boolean } & (
  | { status: "loading"; user: null }
  | { status: "unauthenticated"; user: null }
  | { status: "error"; user: null }
  | { status: "authenticated"; user: Owner }
);

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const me = useMe();
  const [sessionExpired, setSessionExpired] = useState(false);
  const authenticated = useRef(false);
  authenticated.current = Boolean(me.data);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      // Only an active session can "expire"; ignore 401s that arrive when already signed out.
      if (!authenticated.current) return;
      clearSession(queryClient);
      setSessionExpired(true);
    });
    return () => setUnauthorizedHandler(null);
  }, [queryClient]);

  useEffect(() => {
    if (me.data) setSessionExpired(false);
  }, [me.data]);

  const value = useMemo<AuthState>(() => {
    if (me.data) return { status: "authenticated", user: me.data.user, sessionExpired };
    if (me.isPending) return { status: "loading", user: null, sessionExpired };
    if (me.isError) return { status: "error", user: null, sessionExpired };
    return { status: "unauthenticated", user: null, sessionExpired };
  }, [me.data, me.isPending, me.isError, sessionExpired]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used inside AuthProvider");
  return value;
}

/** Retry the session bootstrap after a network/server failure. */
export function useRetrySession() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ME_KEY });
  };
}
