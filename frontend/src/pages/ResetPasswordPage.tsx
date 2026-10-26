import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useResetPassword } from "../api/auth";
import { ApiError } from "../api/client";
import { Button } from "../components/ui/Button";
import { ErrorMessage } from "../components/ui/ErrorMessage";
import { PasswordField } from "../components/ui/PasswordField";
import {
  resetPasswordSchema,
  type ResetPasswordInput,
} from "../schemas/auth";

const INVALID_LINK_MESSAGE =
  "This password reset link is invalid or has expired. Request a new one.";

function resetError(error: unknown): string {
  if (
    error instanceof ApiError &&
    (error.status === 400 || error.status === 404 || error.status === 410)
  ) {
    return INVALID_LINK_MESSAGE;
  }
  return "Could not reset your password. Check your connection and try again.";
}

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [token] = useState(() => searchParams.get("token")?.trim() ?? "");
  useEffect(() => {
    if (searchParams.has("token")) navigate("/reset-password", { replace: true });
  }, [navigate, searchParams]);
  const resetPassword = useResetPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ResetPasswordInput>({ resolver: zodResolver(resetPasswordSchema) });

  const onSubmit = (values: ResetPasswordInput) => {
    if (!token || resetPassword.isPending) return;
    resetPassword.mutate(
      { token, password: values.password },
      {
        onSuccess: () =>
          navigate("/login", { replace: true, state: { passwordReset: true } }),
      },
    );
  };

  if (!token) {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>Reset link unavailable</h1>
          <ErrorMessage>{INVALID_LINK_MESSAGE}</ErrorMessage>
          <Link to="/forgot-password" className="btn btn-primary">
            Request a new link
          </Link>
          <Link to="/login">Back to sign in</Link>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <h1>Choose a new password</h1>
        <p className="muted">Use at least 10 characters.</p>
        <PasswordField
          label="New password"
          autoComplete="new-password"
          enterKeyHint="next"
          error={errors.password?.message}
          {...register("password")}
        />
        <PasswordField
          label="Confirm new password"
          autoComplete="new-password"
          enterKeyHint="done"
          error={errors.passwordConfirmation?.message}
          {...register("passwordConfirmation")}
        />
        {resetPassword.isError ? (
          <ErrorMessage>{resetError(resetPassword.error)}</ErrorMessage>
        ) : null}
        <Button type="submit" disabled={resetPassword.isPending}>
          {resetPassword.isPending ? "Resetting…" : "Reset password"}
        </Button>
        <Link to="/login">Back to sign in</Link>
      </form>
    </main>
  );
}
