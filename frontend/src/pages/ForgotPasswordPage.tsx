import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link } from "react-router-dom";
import { useForgotPassword } from "../api/auth";
import { Button } from "../components/ui/Button";
import { ErrorMessage } from "../components/ui/ErrorMessage";
import { TextField } from "../components/ui/TextField";
import {
  forgotPasswordSchema,
  type ForgotPasswordInput,
} from "../schemas/auth";

const CONFIRMATION =
  "If an account exists for that email, a password reset link has been sent.";

export function ForgotPasswordPage() {
  const forgotPassword = useForgotPassword();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ForgotPasswordInput>({ resolver: zodResolver(forgotPasswordSchema) });

  const onSubmit = (values: ForgotPasswordInput) => {
    if (forgotPassword.isPending) return;
    forgotPassword.mutate(values);
  };

  if (forgotPassword.isSuccess) {
    return (
      <main className="login-page">
        <section className="login-card">
          <h1>Check your email</h1>
          <p role="status">{CONFIRMATION}</p>
          <Link to="/login" className="btn btn-primary">
            Back to sign in
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="login-page">
      <form className="login-card" onSubmit={handleSubmit(onSubmit)} noValidate>
        <h1>Reset your password</h1>
        <p className="muted">
          Enter your owner email and we will send password reset instructions.
        </p>
        <TextField
          label="Email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          error={errors.email?.message}
          {...register("email")}
        />
        {forgotPassword.isError ? (
          <ErrorMessage>
            Could not request a password reset. Check your connection and try again.
          </ErrorMessage>
        ) : null}
        <Button type="submit" disabled={forgotPassword.isPending}>
          {forgotPassword.isPending ? "Sending…" : "Send reset link"}
        </Button>
        <Link to="/login">Back to sign in</Link>
      </form>
    </main>
  );
}
