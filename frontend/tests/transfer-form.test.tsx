import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { accraToday } from "../src/lib/dates";
import {
  apiError,
  bank,
  categories,
  cash,
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

function captureTransfer() {
  const bodies: Body[] = [];
  server.use(
    http.post("/api/v1/transfers", async ({ request }) => {
      bodies.push((await request.json()) as Body);
      return HttpResponse.json(transaction({ type: "transfer" }), { status: 201 });
    }),
  );
  return bodies;
}

async function openTransfer() {
  const result = renderApp("/transactions/new");
  const user = userEvent.setup();
  await user.click(await screen.findByRole("radio", { name: "Transfer" }));
  const amount = await screen.findByLabelText("Amount");
  await waitFor(() => expect(screen.getByLabelText("From")).toHaveValue(bank.id));
  return { ...result, user, amount };
}

describe("transfer form", () => {
  it("shows From and To instead of a category, with different defaults", async () => {
    await openTransfer();
    expect(screen.getByLabelText("From")).toHaveValue(bank.id);
    expect(screen.getByLabelText("To")).toHaveValue(momo.id);
    expect(screen.queryByLabelText("Category")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Date")).toHaveValue(accraToday());
    expect(screen.getByLabelText("Amount")).toHaveAttribute("inputmode", "decimal");
  });

  it("keeps the amount when the owner switches between the types", async () => {
    const { user, amount } = await openTransfer();
    await user.type(amount, "75");
    await user.click(screen.getByRole("radio", { name: "Expense" }));
    expect(screen.getByLabelText("Amount")).toHaveValue("75");
  });

  it("refuses the same account on both sides without sending anything", async () => {
    const bodies = captureTransfer();
    const { user, amount } = await openTransfer();
    await user.type(amount, "10");
    await user.selectOptions(screen.getByLabelText("To"), bank.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Choose two different accounts")).toBeInTheDocument();
    expect(bodies).toHaveLength(0);
  });

  it("sends a transfer with no fee, naming it from the two accounts when the name is blank", async () => {
    const bodies = captureTransfer();
    const { user, amount } = await openTransfer();
    await user.type(amount, "500");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      name: "Bank to MoMo",
      amount: "500.00",
      transaction_date: accraToday(),
      source_account_id: bank.id,
      destination_account_id: momo.id,
    });
    expect(bodies[0]).not.toHaveProperty("fee_amount");
    expect(typeof bodies[0].id).toBe("string");
  });

  it("adds a fee charged to the destination or the source account", async () => {
    const bodies = captureTransfer();
    const { user, amount } = await openTransfer();
    await user.type(amount, "500");
    expect(screen.queryByLabelText("Fee amount")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Add a fee" }));
    await user.type(screen.getByLabelText("Fee amount"), "5");
    const charged = screen.getByRole("radiogroup", { name: "Charged to" });
    expect(within(charged).getByRole("radio", { name: "From account" })).toHaveAttribute("aria-checked", "true");
    await user.click(within(charged).getByRole("radio", { name: "To account" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(bodies[0]).toMatchObject({ fee_amount: "5.00", fee_account_id: momo.id });
  });

  it("charges the fee to the source account by default", async () => {
    const bodies = captureTransfer();
    const { user, amount } = await openTransfer();
    await user.type(amount, "500");
    await user.click(screen.getByRole("button", { name: "Add a fee" }));
    await user.type(screen.getByLabelText("Fee amount"), "2.5");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(bodies[0]).toMatchObject({ fee_amount: "2.50", fee_account_id: bank.id });
  });

  it("ignores a blank or zero fee", async () => {
    const bodies = captureTransfer();
    const { user, amount } = await openTransfer();
    await user.type(amount, "500");
    await user.click(screen.getByRole("button", { name: "Add a fee" }));
    await user.type(screen.getByLabelText("Fee amount"), "0");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(bodies[0]).not.toHaveProperty("fee_amount");
  });

  it("needs two accounts to transfer between", async () => {
    financeHandlers({ accounts: [bank] });
    renderApp("/transactions/new");
    await userEvent.setup().click(await screen.findByRole("radio", { name: "Transfer" }));
    expect(await screen.findByText("Add a second account to transfer between")).toBeInTheDocument();
  });

  it("reuses one client id when a failed save is retried", async () => {
    const ids: unknown[] = [];
    server.use(
      http.post("/api/v1/transfers", async ({ request }) => {
        ids.push(((await request.json()) as Body).id);
        if (ids.length === 1) return apiError("internal_error", "Server error", 500);
        return HttpResponse.json(transaction({ type: "transfer" }), { status: 201 });
      }),
    );
    const { user, amount } = await openTransfer();
    await user.type(amount, "10");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.getByLabelText("Amount")).toHaveValue("10");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("remembers the sending account", async () => {
    captureTransfer();
    const { user, amount } = await openTransfer();
    await user.type(amount, "10");
    await user.selectOptions(screen.getByLabelText("From"), cash.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(localStorage.getItem("finance.lastAccountId")).toBe(cash.id);
  });
});

describe("expense with a fee (payment to another person)", () => {
  async function openExpense() {
    renderApp("/transactions/new");
    const amount = await screen.findByLabelText("Amount");
    await waitFor(() => expect(screen.getByLabelText("Account")).toHaveValue(bank.id));
    return { amount, user: userEvent.setup() };
  }

  it("offers an optional fee and sends it with the fee account", async () => {
    const bodies: Body[] = [];
    server.use(
      http.post("/api/v1/transactions/expenses", async ({ request }) => {
        bodies.push((await request.json()) as Body);
        return HttpResponse.json(transaction(), { status: 201 });
      }),
    );
    const { amount, user } = await openExpense();
    await user.type(amount, "100");
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Sent to someone else? Add a fee" }));
    await user.type(screen.getByLabelText("Fee amount"), "2");
    await user.selectOptions(screen.getByLabelText("Fee account"), momo.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(bodies[0]).toMatchObject({
      amount: "100.00",
      fee_amount: "2.00",
      fee_account_id: momo.id,
    });
  });

  it("sends no fee when the section stays closed", async () => {
    const bodies: Body[] = [];
    server.use(
      http.post("/api/v1/transactions/expenses", async ({ request }) => {
        bodies.push((await request.json()) as Body);
        return HttpResponse.json(transaction(), { status: 201 });
      }),
    );
    const { amount, user } = await openExpense();
    await user.type(amount, "100");
    await user.selectOptions(screen.getByLabelText("Category"), categories.food.id);
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(bodies[0]).not.toHaveProperty("fee_amount");
  });

  it("does not offer a fee on income", async () => {
    const { user } = await openExpense();
    await user.click(screen.getByRole("radio", { name: "Income" }));
    expect(screen.queryByRole("button", { name: "Sent to someone else? Add a fee" })).not.toBeInTheDocument();
  });
});
