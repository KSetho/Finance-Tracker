import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { account, apiError, bank, cash, momo, signedIn } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

beforeEach(() => signedIn());

function listHandler(items = [bank, momo, cash], combined = "2300.00") {
  server.use(
    http.get("/api/v1/accounts", () => HttpResponse.json({ items, combined_balance: combined })),
  );
}

describe("accounts list", () => {
  it("shows each account with its type and balance, and the combined total", async () => {
    listHandler();
    renderApp("/accounts");
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(await screen.findByText("GH₵ 2,300.00")).toBeInTheDocument();
    expect(screen.getByText("Combined balance")).toBeInTheDocument();
    const bankCard = screen.getByRole("link", { name: /bank/i });
    expect(within(bankCard).getByText("GH₵ 2,000.00")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /momo/i })).getByText("Mobile money")).toBeInTheDocument();
    expect(within(screen.getByRole("link", { name: /cash/i })).getByText("GH₵ 0.00")).toBeInTheDocument();
  });

  it("shows a negative balance as text with a minus sign", async () => {
    listHandler([account({ balance: "-50.00" })], "-50.00");
    renderApp("/accounts");
    expect((await screen.findAllByText("-GH₵ 50.00")).length).toBeGreaterThan(0);
  });

  it("shows a loading placeholder, then the list", async () => {
    server.use(
      http.get("/api/v1/accounts", async () => {
        await delay(100);
        return HttpResponse.json({ items: [bank], combined_balance: "2000.00" });
      }),
    );
    renderApp("/accounts");
    expect(await screen.findByRole("status", { name: "Loading accounts" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /bank/i })).toBeInTheDocument();
  });

  it("shows an empty state that leads to creating the first account", async () => {
    listHandler([], "0.00");
    renderApp("/accounts");
    expect(await screen.findByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add your first account" })).toHaveAttribute(
      "href",
      "/accounts/new",
    );
  });

  it("shows an error banner and recovers on retry", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/accounts", () => {
        calls += 1;
        if (calls === 1) return apiError("internal_error", "boom", 500);
        return HttpResponse.json({ items: [bank], combined_balance: "2000.00" });
      }),
    );
    renderApp("/accounts");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load accounts.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /bank/i })).toBeInTheDocument();
  });

  it("asks for archived accounts only when the toggle is on", async () => {
    const seen: string[] = [];
    server.use(
      http.get("/api/v1/accounts", ({ request }) => {
        seen.push(new URL(request.url).searchParams.get("include_archived") ?? "false");
        return HttpResponse.json({
          items: [bank, account({ id: "x", name: "Old", account_type: "cash", is_archived: true })],
          combined_balance: "2000.00",
        });
      }),
    );
    renderApp("/accounts");
    await screen.findByRole("link", { name: /bank/i });
    await userEvent.setup().click(screen.getByRole("checkbox", { name: "Show archived" }));
    await waitFor(() => expect(seen).toContain("true"));
    expect(await screen.findByText("Archived")).toBeInTheDocument();
  });

  it("offers New account within thumb reach", async () => {
    listHandler();
    renderApp("/accounts");
    expect(await screen.findByRole("link", { name: "New account" })).toHaveAttribute("href", "/accounts/new");
  });
});

describe("new account form", () => {
  async function fillName(user: ReturnType<typeof userEvent.setup>, name: string) {
    await user.type(await screen.findByLabelText("Name"), name);
  }

  it("validates the name and the date", async () => {
    renderApp("/accounts/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Save account" }));
    expect(await screen.findByText("Enter a name")).toBeInTheDocument();

    await user.clear(screen.getByLabelText("Opening date"));
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByText("Choose a date")).toBeInTheDocument();
  });

  it("only lets amounts with up to two decimals be typed, and defaults a blank one to 0.00", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/accounts", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(bank, { status: 201 });
      }),
    );
    listHandler();
    renderApp("/accounts/new");
    const user = userEvent.setup();
    const amount = await screen.findByLabelText("Opening balance");
    await user.type(amount, "-5x1.234");
    expect(amount).toHaveValue("51.23");
    await user.clear(amount);
    await fillName(user, "Bank");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    await waitFor(() => expect(body).toBeDefined());
    expect(body).toMatchObject({ name: "Bank", account_type: "bank", opening_balance: "0.00" });
    expect(typeof body?.id).toBe("string");
  });

  it("sends the chosen type and a normalized amount, then returns to the list", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/accounts", async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(momo, { status: 201 });
      }),
    );
    listHandler();
    renderApp("/accounts/new");
    const user = userEvent.setup();
    await fillName(user, "MTN MoMo");
    await user.click(screen.getByRole("radio", { name: "Mobile money" }));
    await user.type(screen.getByLabelText("Opening balance"), "300.5");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(body).toMatchObject({
      name: "MTN MoMo",
      account_type: "mobile_money",
      opening_balance: "300.50",
    });
  });

  it("reuses one client id when a failed save is retried, so no duplicate can be made", async () => {
    const ids: unknown[] = [];
    server.use(
      http.post("/api/v1/accounts", async ({ request }) => {
        const body = (await request.json()) as { id: string };
        ids.push(body.id);
        if (ids.length === 1) return apiError("internal_error", "boom", 500);
        return HttpResponse.json(bank, { status: 201 });
      }),
    );
    listHandler();
    renderApp("/accounts/new");
    const user = userEvent.setup();
    await fillName(user, "Bank");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toHaveValue("Bank"); // values kept
    await user.click(screen.getByRole("button", { name: "Save account" }));
    await screen.findByRole("heading", { name: "Accounts" });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("shows Saving… and a single request while a save is pending", async () => {
    let calls = 0;
    server.use(
      http.post("/api/v1/accounts", async () => {
        calls += 1;
        await delay(150);
        return HttpResponse.json(bank, { status: 201 });
      }),
    );
    listHandler();
    renderApp("/accounts/new");
    const user = userEvent.setup();
    await fillName(user, "Bank");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    const pending = await screen.findByRole("button", { name: "Saving…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    await screen.findByRole("heading", { name: "Accounts" });
    expect(calls).toBe(1);
  });
});

describe("edit account", () => {
  function editHandlers(overrides = momo) {
    server.use(http.get(`/api/v1/accounts/${overrides.id}`, () => HttpResponse.json(overrides)));
  }

  it("prefills the saved values", async () => {
    editHandlers();
    renderApp(`/accounts/${momo.id}/edit`);
    expect(await screen.findByLabelText("Name")).toHaveValue("MoMo");
    expect(screen.getByLabelText("Opening balance")).toHaveValue("300.00");
    expect(screen.getByLabelText("Opening date")).toHaveValue("2026-10-01");
    expect(screen.getByRole("radio", { name: "Mobile money" })).toHaveAttribute("aria-checked", "true");
  });

  it("archives after confirmation, warning when money is still in the account", async () => {
    let archived = 0;
    editHandlers();
    server.use(
      http.post(`/api/v1/accounts/${momo.id}/archive`, () => {
        archived += 1;
        return HttpResponse.json({ ...momo, is_archived: true });
      }),
    );
    listHandler([bank], "2000.00");
    renderApp(`/accounts/${momo.id}/edit`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive account" }));
    const dialog = screen.getByRole("dialog", { name: "Archive this account?" });
    expect(dialog).toHaveTextContent("GH₵ 300.00");
    await user.click(within(dialog).getByRole("button", { name: "Archive" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(archived).toBe(1);
  });

  it("does not archive when the confirmation is cancelled", async () => {
    let archived = 0;
    editHandlers();
    server.use(
      http.post(`/api/v1/accounts/${momo.id}/archive`, () => {
        archived += 1;
        return HttpResponse.json(momo);
      }),
    );
    renderApp(`/accounts/${momo.id}/edit`);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Archive account" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(archived).toBe(0);
  });

  it("saves changes with PATCH", async () => {
    let body: Record<string, unknown> | undefined;
    editHandlers();
    server.use(
      http.patch(`/api/v1/accounts/${momo.id}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...momo, name: "MTN MoMo" });
      }),
    );
    listHandler();
    renderApp(`/accounts/${momo.id}/edit`);
    const user = userEvent.setup();
    const name = await screen.findByLabelText("Name");
    await user.clear(name);
    await user.type(name, "MTN MoMo");
    await user.click(screen.getByRole("button", { name: "Save account" }));
    expect(await screen.findByRole("heading", { name: "Accounts" })).toBeInTheDocument();
    expect(body).toMatchObject({ name: "MTN MoMo", opening_balance: "300.00", opening_date: "2026-10-01" });
  });

  it("shows a not-found message for an unknown account", async () => {
    server.use(
      http.get("/api/v1/accounts/missing", () => apiError("not_found", "Not found.", 404)),
    );
    renderApp("/accounts/missing/edit");
    expect(await screen.findByText("Account not found")).toBeInTheDocument();
  });
});
