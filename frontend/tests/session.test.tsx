import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { api } from "../src/api/client";
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

let signedIn = true;
let logoutCsrf: string | null = null;
let logoutCalls = 0;

beforeEach(() => {
  signedIn = true;
  logoutCsrf = null;
  logoutCalls = 0;
  server.use(
    http.get("/api/v1/auth/me", () => (signedIn ? HttpResponse.json(session) : unauthenticated())),
    http.post("/api/v1/auth/logout", ({ request }) => {
      logoutCalls += 1;
      logoutCsrf = request.headers.get("x-csrf-token");
      signedIn = false;
      return new HttpResponse(null, { status: 204 });
    }),
  );
});

describe("logout", () => {
  const entryPoints: Array<[string, string, (user: ReturnType<typeof userEvent.setup>) => Promise<void>]> = [
    [
      "the sidebar",
      "/dashboard",
      async (user) => {
        const nav = await screen.findByRole("navigation", { name: /main/i });
        await user.click(within(nav).getByRole("button", { name: /logout/i }));
      },
    ],
    [
      "the mobile More sheet",
      "/dashboard",
      async (user) => {
        const nav = await screen.findByRole("navigation", { name: /mobile/i });
        await user.click(within(nav).getByRole("button", { name: "More" }));
        const sheet = screen.getByRole("dialog", { name: "More" });
        await user.click(within(sheet).getByRole("button", { name: /logout/i }));
      },
    ],
    [
      "the settings page",
      "/settings",
      async (user) => {
        const main = await screen.findByRole("main");
        await user.click(within(main).getByRole("button", { name: /logout/i }));
      },
    ],
  ];

  it.each(entryPoints)(
    "from %s sends the CSRF header, clears cached data and returns to /login",
    async (_name, path, click) => {
      const { queryClient } = renderApp(path);
      await screen.findByText("owner@example.com");
      queryClient.setQueryData(["accounts"], [{ id: 1 }]);

      await click(userEvent.setup());

      expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
      expect(logoutCalls).toBe(1);
      expect(logoutCsrf).toBe("csrf-1");
      expect(queryClient.getQueryData(["accounts"])).toBeUndefined();
      expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
    },
  );
});

describe("expired sessions", () => {
  it("redirects to /login with a notice when any API call returns 401", async () => {
    server.use(http.get("/api/v1/accounts", unauthenticated));
    renderApp("/dashboard");
    await screen.findByText("owner@example.com");

    await act(async () => {
      await api("/accounts").catch(() => undefined);
    });

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/session expired, please sign in again/i);
  });

  it("does not show the expiry notice for a failed sign in", async () => {
    signedIn = false;
    server.use(
      http.post("/api/v1/auth/login", () =>
        HttpResponse.json(
          { error: { code: "invalid_credentials", message: "Invalid email or password." } },
          { status: 401 },
        ),
      ),
    );
    renderApp("/login");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/email/i), "owner@example.com");
    await user.type(screen.getByLabelText(/password/i), "a-long-password");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password.");
    expect(screen.queryByText(/session expired/i)).not.toBeInTheDocument();
  });
});
