import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import {
  account,
  apiError,
  bank,
  categories,
  financeHandlers,
  momo,
  signedIn,
  transaction,
} from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

const entry = transaction({ description: "Weekly shop" });
const path = `/transactions/${entry.id}`;

beforeEach(() => {
  signedIn();
  financeHandlers();
});

function detail(row = entry) {
  server.use(http.get(`/api/v1/transactions/${row.id}`, () => HttpResponse.json(row)));
}

describe("transaction detail", () => {
  it("shows every field", async () => {
    detail();
    renderApp(path);
    expect(await screen.findByRole("heading", { name: "Groceries" })).toBeInTheDocument();
    expect(screen.getByText("-GH₵ 150.00")).toBeInTheDocument();
    expect(screen.getByText("14 Oct 2026")).toBeInTheDocument();
    expect(screen.getByText("Bank")).toBeInTheDocument();
    expect(screen.getByText("Food")).toBeInTheDocument();
    expect(screen.getByText("Weekly shop")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete" })).toBeInTheDocument();
  });

  it("shows a not-found state", async () => {
    server.use(http.get(`/api/v1/transactions/${entry.id}`, () => apiError("not_found", "Not found.", 404)));
    renderApp(path);
    expect(await screen.findByText("Transaction not found")).toBeInTheDocument();
  });

  it("edits with the version it read and returns to the list", async () => {
    detail();
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch(`/api/v1/transactions/${entry.id}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...entry, amount: "175.50", version: 2 });
      }),
    );
    renderApp(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const amount = await screen.findByLabelText("Amount");
    expect(amount).toHaveValue("150.00");
    await waitFor(() => expect(screen.getByLabelText("Category")).toHaveValue(categories.food.id));
    expect(screen.getByLabelText("Account")).toHaveValue(bank.id);
    expect(screen.getByLabelText("Date")).toHaveValue("2026-10-14");
    expect(screen.getByLabelText("Name")).toHaveValue("Groceries");
    expect(screen.getByLabelText("Description")).toHaveValue("Weekly shop");

    await user.clear(amount);
    await user.type(amount, "175.5");
    await user.selectOptions(screen.getByLabelText("Account"), momo.id);
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(body).toMatchObject({
      version: 1,
      amount: "175.50",
      account_id: momo.id,
      category_id: categories.food.id,
      transaction_date: "2026-10-14",
      name: "Groceries",
      description: "Weekly shop",
    });
  });

  it("keeps an archived account selectable while editing its own entry", async () => {
    const archived = account({ id: "arch", name: "Old wallet", account_type: "cash", is_archived: true });
    const row = transaction({ account: { id: "arch", name: "Old wallet" } });
    financeHandlers({ accounts: [bank, momo] });
    server.use(http.get(`/api/v1/transactions/${row.id}`, () => HttpResponse.json(row)));
    server.use(
      http.get("/api/v1/accounts/arch", () => HttpResponse.json(archived)),
    );
    renderApp(`/transactions/${row.id}`);
    await userEvent.setup().click(await screen.findByRole("button", { name: "Edit" }));
    const select = await screen.findByLabelText("Account");
    expect(within(select).getByRole("option", { name: "Old wallet (archived)" })).toBeInTheDocument();
    expect(select).toHaveValue("arch");
  });

  it("explains a stale version and reloads on request", async () => {
    let reads = 0;
    server.use(
      http.get(`/api/v1/transactions/${entry.id}`, () => {
        reads += 1;
        return HttpResponse.json(reads > 1 ? { ...entry, name: "Changed elsewhere", version: 2 } : entry);
      }),
      http.patch(`/api/v1/transactions/${entry.id}`, () =>
        apiError("stale_version", "This entry changed on another device. Reload it and try again.", 409),
      ),
    );
    renderApp(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.click(await screen.findByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This entry changed on another device");
    await user.click(screen.getByRole("button", { name: "Reload" }));
    expect(await screen.findByRole("heading", { name: "Changed elsewhere" })).toBeInTheDocument();
    expect(reads).toBeGreaterThan(1);
  });

  it("deletes only after confirmation, and only once", async () => {
    detail();
    let deletes = 0;
    server.use(
      http.delete(`/api/v1/transactions/${entry.id}`, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this entry?" });
    expect(deletes).toBe(0);
    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await user.click(confirm);
    await user.click(confirm);
    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(deletes).toBe(1);
  });

  it("keeps the entry when the confirmation is cancelled", async () => {
    detail();
    let deletes = 0;
    server.use(
      http.delete(`/api/v1/transactions/${entry.id}`, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderApp(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(deletes).toBe(0);
    expect(screen.getByRole("heading", { name: "Groceries" })).toBeInTheDocument();
  });

  it("shows an error when deleting fails", async () => {
    detail();
    server.use(http.delete(`/api/v1/transactions/${entry.id}`, () => apiError("internal_error", "boom", 500)));
    renderApp(path);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Delete this entry?" })).getByRole("button", { name: "Delete" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not delete/i);
    expect(screen.getByRole("heading", { name: "Groceries" })).toBeInTheDocument();
  });
});
