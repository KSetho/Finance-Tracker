"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { useLogin } from "../api/auth";
import { ApiError } from "../api/client";
import { useAuth, useRetrySession } from "../auth/AuthProvider";
import { Button } from "../components/ui/Button";
import { ErrorBanner } from "../components/ui/ErrorBanner";
import { ErrorMessage } from "../components/ui/ErrorMessage";
import { LoadingScreen } from "../components/ui/LoadingScreen";
import { PasswordField } from "../components/ui/PasswordField";
import { TextField } from "../components/ui/TextField";
import { loginSchema, type LoginInput } from "../schemas/auth";

function retryHint(seconds: number | null): string {
  if (seconds === null) return "Try again later.";
  if (seconds <= 60) return "Try again in about a minute.";
  return `Try again in about ${Math.ceil(seconds / 60)} minutes.`;
}

function errorText(error: unknown): string | null {
  if (!error) return null;
  if (error instanceof ApiError) {
    if (error.status === 429) return `Too many attempts. ${retryHint(error.retryAfter)}`;
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export function LoginPage() {
  const auth = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const passwordReset = searchParams.get("passwordReset") === "1";
  const from = searchParams.get("from");
  // Only same-origin app paths; "//host" would be an open redirect.
  const target = from && from.startsWith("/") && !from.startsWith("//") && from !== "/login" ? from : "/dashboard";
  const authenticated = auth.status === "authenticated";
  const login = useLogin();
  const retrySession = useRetrySession();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  useEffect(() => {
    if (authenticated) router.replace(target);
  }, [authenticated, target, router]);

  if (auth.status === "loading" || authenticated) return <LoadingScreen />;
  if (auth.status === "error") {
    return (
      <main className="content" style={{ padding: "1.5rem 1rem" }}>
        <ErrorBanner
          message="Could not reach the server to check your session. Check your connection and try again."
          onRetry={retrySession}
        />
      </main>
    );
  }

  const onSubmit = (values: LoginInput) => {
    if (login.isPending) return;
    login.mutate(values);
  };

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <h1>Sign in</h1>
        <p className="muted">Finance Tracker is private. Sign in with the owner account.</p>
        {auth.sessionExpired ? (
          <p className="notice" role="status">
            Session expired, please sign in again.
          </p>
        ) : null}
        {passwordReset ? (
          <p className="notice" role="status">
            Password reset. Sign in with your new password.
          </p>
        ) : null}
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          error={errors.email?.message}
          {...register("email")}
        />
        <PasswordField
          label="Password"
          autoComplete="current-password"
          enterKeyHint="go"
          error={errors.password?.message}
          {...register("password")}
        />
        <Link href="/forgot-password">Forgot password?</Link>
        {errorText(login.error) ? <ErrorMessage>{errorText(login.error)!}</ErrorMessage> : null}
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? "Signing in…" : "Sign in"}
        </Button>
      </form>
    </main>
  );
}
