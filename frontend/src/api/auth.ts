import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { ForgotPasswordInput, LoginInput } from "../schemas/auth";
import { ApiError, api, setCsrfToken } from "./client";

export type Owner = { id: string; email: string };
export type Session = { user: Owner; csrf_token: string; expires_at: string };

export const ME_KEY = ["auth", "me"] as const;

/** Mark the browser as signed out and drop every cached server value. */
export function clearSession(queryClient: QueryClient): void {
  setCsrfToken(null);
  queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== "auth" });
  queryClient.setQueryData(ME_KEY, null);
}

export function useMe() {
  return useQuery<Session | null>({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        const session = await api<Session>("/auth/me", { skipUnauthorizedHandler: true });
        setCsrfToken(session.csrf_token);
        return session;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useLogin() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LoginInput) =>
      api<Session>("/auth/login", { method: "POST", body: input, skipUnauthorizedHandler: true }),
    onSuccess: (session) => {
      setCsrfToken(session.csrf_token);
      queryClient.setQueryData(ME_KEY, session);
    },
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (input: ForgotPasswordInput) =>
      api<void>("/auth/forgot-password", {
        method: "POST",
        body: { email: input.email.trim() },
        skipUnauthorizedHandler: true,
      }),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      api<void>("/auth/reset-password", {
        method: "POST",
        body: { token, password },
        skipUnauthorizedHandler: true,
      }),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      try {
        await api<void>("/auth/logout", { method: "POST", skipUnauthorizedHandler: true });
      } catch (error) {
        // Already signed out on the server: same end state as a successful logout.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    },
    onSuccess: () => clearSession(queryClient),
  });
}
