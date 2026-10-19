import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { bank, cash, categories, momo, signedIn, type AccountFixture } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

/** A small in-memory stand-in for the API, so whole journeys can run through the real screens. */
type Row = {
  id: string;
  type: "income" | "expense" | "transfer";
  name: string;
  amount: number; // pesewas: the fake does its sums on integers
  date: string;
  account: AccountFixture;
  destination?: AccountFixture;
  category?: (typeof categories)[keyof typeof categories];
  parent?: string;
  feeAmount: number;
};

const toPesewas = (value: string) => Math.round(Number(value) * 100);
const fmt = (pesewas: number) => (pesewas / 100).toFixed(2);

function fakeApi() {
  const accounts = [bank, momo, cash];
  const rows: Row[] = [];
  let id = 0;

  const balance = (a: AccountFixture) =>
    toPesewas(a.opening_balance) +
    rows.reduce((sum, r) => {
      if (r.account.id === a.id) sum += r.type === "income" ? r.amount : -r.amount;
      if (r.destination?.id === a.id) sum += r.amount;
      return sum;
    }, 0);

  const ref = (a: AccountFixture) => ({ id: a.id, name: a.name });
  const out = (r: Row) => {
    const fee = rows.find((x) => x.parent === r.id);
    return {
      id: r.id,
      type: r.type,
      name: r.name,
      description: null,
      amount: fmt(r.amount),
      transaction_date: r.date,
      account: ref(r.account),
      destination_account: r.destination ? ref(r.destination) : null,
      category: r.category ?? null,
      fee_amount: fmt(r.feeAmount),
      fee: fee ? { id: fee.id, amount: fmt(fee.amount), account: ref(fee.account) } : null,
      is_fee: Boolean(r.parent),
      related_transaction_id: r.parent ?? null,
      version: 1,
    };
  };
  const accountById = (accountId: string) => accounts.find((a) => a.id === accountId)!;

  server.use(
    http.get("/api/v1/accounts", () =>
      HttpResponse.json({
        items: accounts.map((a) => ({ ...a, balance: fmt(balance(a)) })),
        combined_balance: fmt(accounts.reduce((s, a) => s + balance(a), 0)),
      }),
    ),
    http.get("/api/v1/categories", ({ request }) => {
      const type = new URL(request.url).searchParams.get("type");
      return HttpResponse.json({
        items: Object.values(categories).filter((c) => !type || c.category_type === type),
      });
    }),
    http.post("/api/v1/transactions/:kind", async ({ request, params }) => {
      const body = (await request.json()) as Record<string, string>;
      const row: Row = {
        id: `row-${++id}`,
        type: params.kind === "income" ? "income" : "expense",
        name: body.name,
        amount: toPesewas(body.amount),
        date: body.transaction_date,
        account: accountById(body.account_id),
        category: Object.values(categories).find((c) => c.id === body.category_id),
        feeAmount: body.fee_amount ? toPesewas(body.fee_amount) : 0,
      };
      rows.push(row);
      return HttpResponse.json(out(row), { status: 201 });
    }),
    http.post("/api/v1/transfers", async ({ request }) => {
      const body = (await request.json()) as Record<string, string>;
      const parent: Row = {
        id: `row-${++id}`,
        type: "transfer",
        name: body.name,
        amount: toPesewas(body.amount),
        date: body.transaction_date,
        account: accountById(body.source_account_id),
        destination: accountById(body.destination_account_id),
        feeAmount: body.fee_amount ? toPesewas(body.fee_amount) : 0,
      };
      rows.push(parent);
      if (parent.feeAmount > 0) {
        rows.push({
          id: `row-${++id}`,
          type: "expense",
          name: `Fee: ${parent.name}`,
          amount: parent.feeAmount,
          date: parent.date,
          account: accountById(body.fee_account_id),
          category: categories.fees,
          parent: parent.id,
          feeAmount: 0,
        });
      }
      return HttpResponse.json(out(parent), { status: 201 });
    }),
    http.get("/api/v1/transactions", () => {
      const items = [...rows].reverse().map(out);
      return HttpResponse.json({ items, page: 1, page_size: 20, total: items.length });
    }),
    http.get("/api/v1/transactions/:id", ({ params }) => {
      const row = rows.find((r) => r.id === params.id);
      return row
        ? HttpResponse.json(out(row))
        : HttpResponse.json({ error: { code: "not_found", message: "Not found." } }, { status: 404 });
    }),
    http.delete("/api/v1/transfers/:id", ({ params }) => {
      for (let i = rows.length - 1; i >= 0; i--) {
        if (rows[i].id === params.id || rows[i].parent === params.id) rows.splice(i, 1);
      }
      return new HttpResponse(null, { status: 204 });
    }),
    http.get("/api/v1/dashboard/summary", () => {
      const sum = (pick: (r: Row) => boolean) => rows.filter(pick).reduce((s, r) => s + r.amount, 0);
      const income = sum((r) => r.type === "income");
      const expenses = sum((r) => r.type === "expense");
      return HttpResponse.json({
        month: "2026-10",
        currency: "GHS",
        total_income: fmt(income),
        total_expenses: fmt(expenses),
        fee_total: fmt(sum((r) => Boolean(r.parent))),
        net_cash_flow: fmt(income - expenses),
        budget: {
          month: "2026-10",
          allowance: null,
          total_expenses: fmt(expenses),
          remaining: null,
          percentage_used: null,
          is_over_budget: false,
        },
        combined_balance: fmt(accounts.reduce((s, a) => s + balance(a), 0)),
        accounts: accounts.map((a) => ({ ...a, balance: fmt(balance(a)) })),
      });
    }),
    http.get("/api/v1/dashboard/spending-by-category", () => HttpResponse.json({ total_expenses: "0.00", items: [] })),
    http.get("/api/v1/dashboard/cash-flow", () =>
      HttpResponse.json({ group_by: "day", income: "0.00", expenses: "0.00", net: "0.00", buckets: [] }),
    ),
    http.get("/api/v1/dashboard/recent-transactions", () =>
      HttpResponse.json({ items: [...rows].reverse().slice(0, 10).map(out) }),
    ),
  );
  return { rows };
}

beforeEach(() => {
  localStorage.clear();
  signedIn();
});

const goTo = async (user: ReturnType<typeof userEvent.setup>, name: string) =>
  user.click(screen.getAllByRole("link", { name })[0]);

async function addExpense(user: ReturnType<typeof userEvent.setup>, amount: string) {
  await user.type(await screen.findByLabelText("Amount"), amount);
  await waitFor(() => expect(screen.getByLabelText("Category")).toBeEnabled());
  await waitFor(() => expect(within(screen.getByLabelText("Category")).getAllByRole("option").length).toBeGreaterThan(1));
  await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
  await user.click(screen.getByRole("button", { name: "Save" }));
  await screen.findByRole("heading", { name: "Transactions" });
}

describe("journeys through the real screens", () => {
  it("an expense changes the balance and the dashboard only after the server confirms", async () => {
    fakeApi();
    renderApp("/transactions/new");
    const user = userEvent.setup();
    await addExpense(user, "150");

    await goTo(user, "Accounts");
    expect(await screen.findByText("GH₵ 1,850.00")).toBeInTheDocument(); // 2,000 less 150
    expect(screen.getByText("GH₵ 2,150.00")).toBeInTheDocument(); // combined

    await goTo(user, "Dashboard");
    const cards = await screen.findByRole("group", { name: "Month summary" });
    await waitFor(() => expect(within(cards).getByText("GH₵ 150.00")).toBeInTheDocument());
  });

  it("a transfer with a fee shows principal and fee separately and moves the money once", async () => {
    fakeApi();
    renderApp("/transactions/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Transfer" }));
    await user.type(await screen.findByLabelText("Amount"), "500");
    await waitFor(() => expect(screen.getByLabelText("To")).toHaveValue(momo.id));
    await user.click(screen.getByRole("button", { name: "Add a fee" }));
    await user.type(screen.getByLabelText("Fee amount"), "5");
    await user.click(
      within(screen.getByRole("radiogroup", { name: "Charged to" })).getByRole("radio", { name: "To account" }),
    );
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });

    const transfer = await screen.findByRole("link", { name: /^bank to momo/i });
    expect(within(transfer).getByText("GH₵ 500.00")).toBeInTheDocument();
    expect(within(transfer).getByText(/Fee GH₵ 5\.00/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /fee for bank to momo/i })).toBeInTheDocument();

    await goTo(user, "Accounts");
    expect(await screen.findByText("GH₵ 1,500.00")).toBeInTheDocument(); // Bank
    expect(screen.getByText("GH₵ 795.00")).toBeInTheDocument(); // MoMo: +500, less the 5 fee
    expect(screen.getByText("GH₵ 2,295.00")).toBeInTheDocument(); // combined: only the fee is gone
  });

  it("deleting the transfer removes the fee too and restores every balance", async () => {
    fakeApi();
    renderApp("/transactions/new");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: "Transfer" }));
    await user.type(await screen.findByLabelText("Amount"), "500");
    await waitFor(() => expect(screen.getByLabelText("To")).toHaveValue(momo.id));
    await user.click(screen.getByRole("button", { name: "Add a fee" }));
    await user.type(screen.getByLabelText("Fee amount"), "5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });

    await user.click(await screen.findByRole("link", { name: /^bank to momo/i }));
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();

    await goTo(user, "Accounts");
    expect(await screen.findByText("GH₵ 2,000.00")).toBeInTheDocument();
    expect(screen.getByText("GH₵ 300.00")).toBeInTheDocument();
    expect(screen.getByText("GH₵ 2,300.00")).toBeInTheDocument();
  });

  it("a session that expires while adding sends the owner to sign in, once, with a notice", async () => {
    fakeApi();
    let posts = 0;
    server.use(
      http.post("/api/v1/transactions/expenses", () => {
        posts += 1;
        return HttpResponse.json({ error: { code: "unauthenticated", message: "Please sign in." } }, { status: 401 });
      }),
      http.get("/api/v1/auth/me", () =>
        posts > 0 ? HttpResponse.json({ error: { code: "unauthenticated", message: "x" } }, { status: 401 }) : undefined,
      ),
    );
    renderApp("/transactions/new");
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText("Amount"), "20");
    await waitFor(() => expect(within(screen.getByLabelText("Category")).getAllByRole("option").length).toBeGreaterThan(1));
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("button", { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/session expired/i);
    expect(posts).toBe(1);
  });
});
