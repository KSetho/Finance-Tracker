import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse, delay } from "msw";
import { describe, expect, it } from "vitest";
import { renderApp } from "./renderApp";
import { server } from "./server";

const owner = { id: "11111111-1111-1111-1111-111111111111", email: "owner@example.com" };
const session = { user: owner, csrf_token: "csrf-1", expires_at: "2026-10-24T12:00:00Z" };

function signedOut() {
  server.use(
    http.get("/api/v1/auth/me", () =>
      HttpResponse.json(
        { error: { code: "unauthenticated", message: "Please sign in." } },
        { status: 401 },
      ),
    ),
  );
}

describe("login page", () => {
  it("links to the public password reset request page", async () => {
    signedOut();
    renderApp("/login");
    expect(await screen.findByRole("link", { name: /forgot password/i })).toHaveAttribute(
      "href",
      "/forgot-password",
    );
  });

  it("shows inline validation errors for empty and malformed input", async () => {
    signedOut();
    renderApp("/login");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/enter your email/i)).toBeInTheDocument();
    expect(screen.getByText(/enter your password/i)).toBeInTheDocument();

    await user.type(screen.getByLabelText(/email/i), "not-an-email");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByText(/valid email/i)).toBeInTheDocument();
  });

  it("navigates to the dashboard after a successful sign in", async () => {
    signedOut();
    server.use(http.post("/api/v1/auth/login", () => HttpResponse.json(session)));
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/i), "owner@example.com");
    await user.type(screen.getByLabelText(/password/i), "a-long-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("disables submit while pending and sends only one request", async () => {
    signedOut();
    let calls = 0;
    server.use(
      http.post("/api/v1/auth/login", async () => {
        calls += 1;
        await delay(150);
        return HttpResponse.json(session);
      }),
    );
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/i), "owner@example.com");
    await user.type(screen.getByLabelText(/password/i), "a-long-password");
    const button = screen.getByRole("button", { name: /sign in/i });
    await user.click(button);
    await waitFor(() => expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled());
    await user.click(screen.getByRole("button", { name: /signing in/i }));
    await screen.findByRole("heading", { name: /dashboard/i });
    expect(calls).toBe(1);
  });

  describe("refusals and errors", () => {
    async function submit(user: ReturnType<typeof userEvent.setup>) {
      await user.type(await screen.findByLabelText(/email/i), "owner@example.com");
      await user.type(screen.getByLabelText(/password/i), "a-long-password");
      await user.click(screen.getByRole("button", { name: /sign in/i }));
    }

    it("shows the generic message on 401", async () => {
      signedOut();
      server.use(
        http.post("/api/v1/auth/login", () =>
          HttpResponse.json(
            { error: { code: "invalid_credentials", message: "Invalid email or password." } },
            { status: 401 },
          ),
        ),
      );
      renderApp("/login");
      await submit(userEvent.setup());
      expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    });

    it("shows a try-again-later message with the retry hint on 429", async () => {
      signedOut();
      server.use(
        http.post("/api/v1/auth/login", () =>
          HttpResponse.json(
            { error: { code: "too_many_attempts", message: "Too many attempts. Try again later." } },
            { status: 429, headers: { "Retry-After": "300" } },
          ),
        ),
      );
      renderApp("/login");
      await submit(userEvent.setup());
      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(/too many attempts/i);
      expect(alert).toHaveTextContent(/5 minutes/i);
    });

    it("shows a generic API error for unexpected server failures", async () => {
      signedOut();
      server.use(http.post("/api/v1/auth/login", () => new HttpResponse("boom", { status: 500 })));
      renderApp("/login");
      await submit(userEvent.setup());
      expect(await screen.findByRole("alert")).toHaveTextContent(/something went wrong/i);
    });

    it("shows a connection message when the network fails", async () => {
      signedOut();
      server.use(http.post("/api/v1/auth/login", () => HttpResponse.error()));
      renderApp("/login");
      await submit(userEvent.setup());
      expect(await screen.findByRole("alert")).toHaveTextContent(/could not reach the server/i);
    });

    it("keeps the entered values after an error", async () => {
      signedOut();
      server.use(
        http.post("/api/v1/auth/login", () =>
          HttpResponse.json(
            { error: { code: "invalid_credentials", message: "Invalid email or password." } },
            { status: 401 },
          ),
        ),
      );
      renderApp("/login");
      await submit(userEvent.setup());
      await screen.findByRole("alert");
      expect(screen.getByLabelText(/email/i)).toHaveValue("owner@example.com");
      expect(screen.getByLabelText(/password/i)).toHaveValue("a-long-password");
      expect(screen.getByRole("button", { name: /sign in/i })).toBeEnabled();
    });
  });

  describe("phone ergonomics", () => {
    it("asks for the email keyboard and disables auto-capitalisation and autocorrect", async () => {
      signedOut();
      renderApp("/login");
      const email = await screen.findByLabelText(/email/i);
      expect(email).toHaveAttribute("type", "email");
      expect(email).toHaveAttribute("inputmode", "email");
      expect(email).toHaveAttribute("autocapitalize", "none");
      expect(email).toHaveAttribute("autocorrect", "off");
      expect(email).toHaveAttribute("autocomplete", "username");
      expect(email).toHaveAttribute("enterkeyhint", "next");
    });

    it("lets the owner reveal and re-hide the password they typed", async () => {
      signedOut();
      renderApp("/login");
      const user = userEvent.setup();
      const password = await screen.findByLabelText(/password/i);
      await user.type(password, "my-secret-pass");
      expect(password).toHaveAttribute("type", "password");
      expect(password).toHaveAttribute("autocomplete", "current-password");
      expect(password).toHaveAttribute("autocapitalize", "none");

      const toggle = screen.getByRole("button", { name: "Show" });
      expect(toggle).toHaveAttribute("aria-pressed", "false");
      await user.click(toggle);
      expect(password).toHaveAttribute("type", "text");
      expect(password).toHaveValue("my-secret-pass");
      expect(screen.getByRole("button", { name: "Hide" })).toHaveAttribute("aria-pressed", "true");
      await user.click(screen.getByRole("button", { name: "Hide" }));
      expect(password).toHaveAttribute("type", "password");
    });

    it("does not submit the form when the show/hide toggle is pressed", async () => {
      signedOut();
      let calls = 0;
      server.use(
        http.post("/api/v1/auth/login", () => {
          calls += 1;
          return HttpResponse.json(session);
        }),
      );
      renderApp("/login");
      const user = userEvent.setup();
      await user.type(await screen.findByLabelText(/email/i), "owner@example.com");
      await user.type(screen.getByLabelText(/password/i), "a-long-password");
      await user.click(screen.getByRole("button", { name: "Show" }));
      expect(calls).toBe(0);
    });
  });
});
