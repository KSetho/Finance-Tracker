import { screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { renderApp } from "./renderApp";
import { server } from "./server";

const session = {
  user: { id: "11111111-1111-1111-1111-111111111111", email: "owner@example.com" },
  csrf_token: "csrf-1",
  expires_at: "2026-10-24T12:00:00Z",
};

const unauthenticated = () =>
  HttpResponse.json(
    { error: { code: "unauthenticated", message: "Please sign in." } },
    { status: 401 },
  );

const protectedRoutes = [
  "/dashboard",
  "/transactions",
  "/transactions/new",
  "/accounts",
  "/budget",
  "/settings",
];

describe("route guard", () => {
  it.each(protectedRoutes)("redirects signed-out visitors from %s to /login", async (path) => {
    server.use(http.get("/api/v1/auth/me", unauthenticated));
    renderApp(path);
    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("redirects a signed-in owner away from /login", async () => {
    server.use(http.get("/api/v1/auth/me", () => HttpResponse.json(session)));
    renderApp("/login");
    expect(await screen.findByRole("heading", { name: /dashboard/i })).toBeInTheDocument();
  });

  it("keeps the owner signed in on reload when /auth/me succeeds", async () => {
    server.use(http.get("/api/v1/auth/me", () => HttpResponse.json(session)));
    renderApp("/accounts");
    expect(await screen.findByRole("heading", { name: /accounts/i })).toBeInTheDocument();
  });

  it("shows a loading state while the session is being checked", () => {
    server.use(http.get("/api/v1/auth/me", () => new Promise(() => {})));
    renderApp("/dashboard");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});
