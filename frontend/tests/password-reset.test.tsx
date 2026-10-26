import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForgotPasswordPage } from "../src/pages/ForgotPasswordPage";
import { ResetPasswordPage } from "../src/pages/ResetPasswordPage";
import { server } from "./server";

function LoginDestination() {
  const location = useLocation();
  const reset = (location.state as { passwordReset?: boolean } | null)?.passwordReset;
  return <h1>{reset ? "Password reset login" : "Login"}</h1>;
}

function renderPasswordRoutes(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <Routes>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/login" element={<LoginDestination />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("forgot password", () => {
  it("validates the email and shows the generic confirmation", async () => {
    let requestBody: unknown;
    server.use(
      http.post("/api/v1/auth/forgot-password", async ({ request }) => {
        requestBody = await request.json();
        return HttpResponse.json(
          { message: "If the account exists, a reset link has been sent." },
          { status: 202 },
        );
      }),
    );
    renderPasswordRoutes("/forgot-password");
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: /send reset link/i }));
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument();
    await user.type(screen.getByLabelText(/email/i), "owner@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    expect(await screen.findByRole("heading", { name: /check your email/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "If an account exists for that email, a password reset link has been sent.",
    );
    expect(requestBody).toEqual({ email: "owner@example.com" });
  });

  it("does not reveal an API error message", async () => {
    server.use(
      http.post("/api/v1/auth/forgot-password", () =>
        HttpResponse.json(
          { error: { code: "unknown_email", message: "No owner has that email." } },
          { status: 404 },
        ),
      ),
    );
    renderPasswordRoutes("/forgot-password");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/email/i), "missing@example.com");
    await user.click(screen.getByRole("button", { name: /send reset link/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/could not request a password reset/i);
    expect(alert).not.toHaveTextContent(/no owner/i);
  });
});

describe("reset password", () => {
  it("requires a token from the query string", () => {
    renderPasswordRoutes("/reset-password");
    expect(screen.getByRole("alert")).toHaveTextContent(/invalid or has expired/i);
    expect(screen.getByRole("link", { name: /request a new link/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("requires at least 10 matching characters", async () => {
    renderPasswordRoutes("/reset-password?token=one-use-token");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^new password$/i), "short");
    await user.type(screen.getByLabelText(/^confirm new password$/i), "different");
    await user.click(screen.getByRole("button", { name: /^reset password$/i }));

    expect(
      await screen.findByText("Password must be at least 10 characters"),
    ).toBeInTheDocument();
    expect(screen.getByText(/passwords do not match/i)).toBeInTheDocument();
  });

  it("handles an expired token without exposing the server response", async () => {
    server.use(
      http.post("/api/v1/auth/reset-password", () =>
        HttpResponse.json(
          { error: { code: "reset_token_expired", message: "Secret token detail." } },
          { status: 410 },
        ),
      ),
    );
    renderPasswordRoutes("/reset-password?token=expired-token");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^new password$/i), "new-password");
    await user.type(screen.getByLabelText(/^confirm new password$/i), "new-password");
    await user.click(screen.getByRole("button", { name: /^reset password$/i }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/invalid or has expired/i);
    expect(alert).not.toHaveTextContent(/secret token/i);
  });

  it("submits the token from the URL, never stores it, and redirects to login", async () => {
    let requestBody: unknown;
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    server.use(
      http.post("/api/v1/auth/reset-password", async ({ request }) => {
        requestBody = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderPasswordRoutes("/reset-password?token=one-use-token");
    const user = userEvent.setup();
    await user.type(screen.getByLabelText(/^new password$/i), "new-password");
    await user.type(screen.getByLabelText(/^confirm new password$/i), "new-password");
    await user.click(screen.getByRole("button", { name: /^reset password$/i }));

    expect(await screen.findByRole("heading", { name: /password reset login/i })).toBeInTheDocument();
    expect(requestBody).toEqual({ token: "one-use-token", password: "new-password" });
    await waitFor(() => expect(storageWrite).not.toHaveBeenCalled());
  });
});
