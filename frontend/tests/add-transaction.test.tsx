import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { accraToday } from "../src/lib/dates";
import {
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

beforeEach(() => {
  localStorage.clear();
  signedIn();
  financeHandlers();
});

type Body = Record<string, unknown>;

function captureCreate(path: "income" | "expenses", status = 201) {
  const bodies: Body[] = [];
  server.use(
    http.post(`/api/v1/transactions/${path}`, async ({ request }) => {
      bodies.push((await request.json()) as Body);
      return HttpResponse.json(transaction(), { status });
    }),
  );
  return bodies;
}

async function openAdd() {
  const result = renderApp("/transactions/new");
  const amount = await screen.findByLabelText("Amount");
  await waitFor(() => expect(screen.getByLabelText("Account")).toHaveValue(bank.id));
  return { ...result, amount, user: userEvent.setup() };
}

describe("add screen defaults", () => {
  it("opens on Expense with the amount focused, a decimal keypad, today's date and an account", async () => {
    await openAdd();
    expect(screen.getByRole("radio", { name: "Expense" })).toHaveAttribute("aria-checked", "true");
    const amount = screen.getByLabelText("Amount");
    expect(amount).toHaveFocus();
    expect(amount).toHaveAttribute("inputmode", "decimal");
    expect(screen.getByLabelText("Date")).toHaveValue(accraToday());
    expect(screen.getByLabelText("Account")).toHaveValue(bank.id);
  });

  it("preselects the account used for the last saved entry", async () => {
    localStorage.setItem("finance.lastAccountId", momo.id);
    renderApp("/transactions/new");
    await waitFor(() => expect(screen.getByLabelText("Account")).toHaveValue(momo.id));
  });

  it("asks for an account first when none exist", async () => {
    financeHandlers({ accounts: [] });
    renderApp("/transactions/new");
    expect(await screen.findByText("Add an account first")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add an account" })).toHaveAttribute("href", "/accounts/new");
  });

  it("only offers archived-free accounts the server returns", async () => {
    await openAdd();
    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual(expect.arrayContaining(["Bank", "MoMo", "Cash"]));
  });
});

describe("categories follow the entry type", () => {
  it("shows expense categories for an expense and income categories for income", async () => {
    const { user } = await openAdd();
    const names = () => screen.getAllByRole("option").map((o) => o.textContent);
    await waitFor(() => expect(names()).toContain("Food"));
    expect(names()).not.toContain("Salary");

    await user.click(screen.getByRole("radio", { name: "Income" }));
    await waitFor(() => expect(names()).toContain("Salary"));
    expect(names()).not.toContain("Food");
    expect(names()).toContain("No category");
  });
});

describe("validation", () => {
  it("asks for an amount, a category and a positive amount without sending anything", async () => {
    const bodies = captureCreate("expenses");
    const { user, amount } = await openAdd();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter an amount")).toBeInTheDocument();
    expect(screen.getByText("Choose a category")).toBeInTheDocument();

    await user.type(amount, "0");
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Amount must be greater than zero")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("only lets two decimals be typed", async () => {
    const { user, amount } = await openAdd();
    await user.type(amount, "12.3456");
    expect(amount).toHaveValue("12.34");
  });
});

describe("saving", () => {
  it("sends a normalized expense, remembers the account, refreshes figures and returns to the list", async () => {
    const bodies = captureCreate("expenses");
    const { user, amount, queryClient } = await openAdd();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    await user.type(amount, "150.5");
    await user.selectOptions(screen.getByLabelText("Account"), momo.id);
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.type(screen.getByLabelText("Name"), "Weekly shopping");
    await user.click(screen.getByRole("button", { name: "Add details" }));
    await user.type(screen.getByLabelText("Description"), "Market");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      name: "Weekly shopping",
      description: "Market",
      amount: "150.50",
      transaction_date: accraToday(),
      account_id: momo.id,
      category_id: categories.food.id,
    });
    expect(typeof bodies[0].id).toBe("string");
    expect(localStorage.getItem("finance.lastAccountId")).toBe(momo.id);
    const keys = invalidate.mock.calls.map((call) => (call[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toEqual(expect.arrayContaining(["accounts", "transactions", "budgets", "dashboard"]));
  });

  it("names the entry after its category when the name is left blank", async () => {
    const bodies = captureCreate("expenses");
    const { user, amount } = await openAdd();
    await user.type(amount, "20");
    await user.selectOptions(screen.getByLabelText("Category"), categories.transport.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(bodies[0].name).toBe("Transport");
  });

  it("saves income to the income endpoint with an optional category", async () => {
    const bodies = captureCreate("income");
    const { user, amount } = await openAdd();
    await user.click(screen.getByRole("radio", { name: "Income" }));
    await user.type(screen.getByLabelText("Amount"), "500");
    await user.type(screen.getByLabelText("Name"), "October salary");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(amount).toBeDefined();
    expect(bodies[0]).toMatchObject({ name: "October salary", amount: "500.00", category_id: null });
  });

  it("shows Saving… and sends one request while a save is pending", async () => {
    let calls = 0;
    server.use(
      http.post("/api/v1/transactions/expenses", async () => {
        calls += 1;
        await delay(150);
        return HttpResponse.json(transaction(), { status: 201 });
      }),
    );
    const { user, amount } = await openAdd();
    await user.type(amount, "10");
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    const pending = await screen.findByRole("button", { name: "Saving…" });
    expect(pending).toBeDisabled();
    await user.click(pending);
    await screen.findByRole("heading", { name: "Transactions" });
    expect(calls).toBe(1);
  });

  it("keeps the values after a failed save and reuses the same client id on retry", async () => {
    const ids: unknown[] = [];
    server.use(
      http.post("/api/v1/transactions/expenses", async ({ request }) => {
        const body = (await request.json()) as Body;
        ids.push(body.id);
        if (ids.length === 1) return apiError("internal_error", "Server error", 500);
        return HttpResponse.json(transaction(), { status: 201 });
      }),
    );
    const { user, amount } = await openAdd();
    await user.type(amount, "10");
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue("10");
    expect(screen.getByLabelText("Category")).toHaveValue(categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("shows the server's explanation for a refused entry", async () => {
    server.use(
      http.post("/api/v1/transactions/expenses", () =>
        apiError("before_opening_date", "That date is before the account's opening date.", 422),
      ),
    );
    const { user, amount } = await openAdd();
    await user.type(amount, "10");
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("before the account's opening date");
  });
});
