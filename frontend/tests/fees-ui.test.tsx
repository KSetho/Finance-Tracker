import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { bank, categories, financeHandlers, momo, signedIn, transaction } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

const transfer = transaction({
  id: "tttttttt-0000-0000-0000-0000000000a1",
  type: "transfer",
  name: "Bank to MoMo",
  amount: "500.00",
  category: null,
  destination_account: { id: momo.id, name: "MoMo" },
  fee_amount: "5.00",
  fee: {
    id: "tttttttt-0000-0000-0000-0000000000a2",
    amount: "5.00",
    account: { id: momo.id, name: "MoMo" },
  },
});
const fee = transaction({
  id: "tttttttt-0000-0000-0000-0000000000a2",
  type: "expense",
  name: "Fee: Bank to MoMo",
  amount: "5.00",
  category: categories.fees,
  account: { id: momo.id, name: "MoMo" },
  is_fee: true,
  related_transaction_id: transfer.id,
});
const payment = transaction({
  id: "tttttttt-0000-0000-0000-0000000000b1",
  name: "Sent to Ama",
  amount: "100.00",
  fee_amount: "2.00",
  fee: { id: "tttttttt-0000-0000-0000-0000000000b2", amount: "2.00", account: { id: bank.id, name: "Bank" } },
});

beforeEach(() => {
  signedIn();
  financeHandlers();
});

function listing(items: unknown[]) {
  server.use(
    http.get("/api/v1/transactions", () =>
      HttpResponse.json({ items, page: 1, page_size: 20, total: items.length }),
    ),
  );
}

describe("history rows", () => {
  it("shows a transfer neutrally, from → to, with its fee", async () => {
    listing([transfer, fee]);
    renderApp("/transactions");
    const row = await screen.findByRole("link", { name: /^bank to momo/i });
    expect(within(row).getByText("GH₵ 500.00")).toBeInTheDocument();
    expect(within(row).queryByText(/^[+-]GH₵ 500\.00$/)).not.toBeInTheDocument();
    expect(within(row).getByText(/Transfer/)).toBeInTheDocument();
    expect(within(row).getByText(/Bank → MoMo/)).toBeInTheDocument();
    expect(within(row).getByText(/Fee GH₵ 5\.00/)).toBeInTheDocument();
  });

  it("labels a fee row as a fee for its transfer", async () => {
    listing([transfer, fee]);
    renderApp("/transactions");
    const row = await screen.findByRole("link", { name: /fee for bank to momo/i });
    expect(within(row).getByText("-GH₵ 5.00")).toBeInTheDocument();
    expect(within(row).getByText(/Fee ·/)).toBeInTheDocument();
  });
});

describe("transfer detail", () => {
  function open(row = transfer) {
    server.use(http.get(`/api/v1/transactions/${row.id}`, () => HttpResponse.json(row)));
    renderApp(`/transactions/${row.id}`);
  }

  it("shows principal and fee on separate lines", async () => {
    open();
    expect(await screen.findByRole("heading", { name: "Bank to MoMo" })).toBeInTheDocument();
    const details = screen.getByRole("list", { name: "Amounts" });
    expect(within(details).getByText("Amount")).toBeInTheDocument();
    expect(within(details).getByText("GH₵ 500.00")).toBeInTheDocument();
    expect(within(details).getByText("Fee")).toBeInTheDocument();
    expect(within(details).getByText(/GH₵ 5\.00 · charged to MoMo/)).toBeInTheDocument();
    expect(screen.getByText("Bank → MoMo")).toBeInTheDocument();
  });

  it("edits through the transfers endpoint with the version it read", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch(`/api/v1/transfers/${transfer.id}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...transfer, amount: "300.00", version: 2 });
      }),
    );
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    const amount = await screen.findByLabelText("Amount");
    expect(amount).toHaveValue("500.00");
    expect(screen.getByLabelText("From")).toHaveValue(bank.id);
    expect(screen.getByLabelText("To")).toHaveValue(momo.id);
    expect(await screen.findByLabelText("Fee amount")).toHaveValue("5.00");
    expect(
      within(screen.getByRole("radiogroup", { name: "Charged to" })).getByRole("radio", { name: "To account" }),
    ).toHaveAttribute("aria-checked", "true");

    await user.clear(amount);
    await user.type(amount, "300");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(body).toMatchObject({
      version: 1,
      amount: "300.00",
      source_account_id: bank.id,
      destination_account_id: momo.id,
      fee_amount: "5.00",
      fee_account_id: momo.id,
    });
  });

  it("removes the fee when the fee amount is cleared", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.patch(`/api/v1/transfers/${transfer.id}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...transfer, fee: null, fee_amount: "0.00", version: 2 });
      }),
    );
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Edit" }));
    await user.clear(await screen.findByLabelText("Fee amount"));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(body).toMatchObject({ fee_amount: "0.00" });
  });

  it("deletes through the transfers endpoint after confirmation", async () => {
    let deletes = 0;
    server.use(
      http.delete(`/api/v1/transfers/${transfer.id}`, () => {
        deletes += 1;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    open();
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "Delete" }));
    const dialog = screen.getByRole("dialog", { name: "Delete this entry?" });
    expect(dialog).toHaveTextContent(/fee/i);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(await screen.findByRole("heading", { name: "Transactions" })).toBeInTheDocument();
    expect(deletes).toBe(1);
  });
});

describe("fee detail", () => {
  it("explains the fee is managed by its transfer and links to it, with no edit or delete", async () => {
    server.use(http.get(`/api/v1/transactions/${fee.id}`, () => HttpResponse.json(fee)));
    renderApp(`/transactions/${fee.id}`);
    expect(await screen.findByText(/managed by its transfer or payment/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "View the transfer or payment" })).toHaveAttribute(
      "href",
      `/transactions/${transfer.id}`,
    );
    expect(screen.queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });
});

describe("payment with a fee", () => {
  it("shows the fee line and edits it with the expense", async () => {
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get(`/api/v1/transactions/${payment.id}`, () => HttpResponse.json(payment)),
      http.patch(`/api/v1/transactions/${payment.id}`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ ...payment, version: 2 });
      }),
    );
    renderApp(`/transactions/${payment.id}`);
    const user = userEvent.setup();
    const details = await screen.findByRole("list", { name: "Amounts" });
    expect(within(details).getByText(/GH₵ 2\.00 · charged to Bank/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Edit" }));
    expect(await screen.findByLabelText("Fee amount")).toHaveValue("2.00");
    await waitFor(() => expect(screen.getByLabelText("Category")).toHaveValue(categories.food.id));
    await user.clear(screen.getByLabelText("Fee amount"));
    await user.type(screen.getByLabelText("Fee amount"), "3");
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await screen.findByRole("heading", { name: "Transactions" });
    expect(body).toMatchObject({ version: 1, fee_amount: "3.00", fee_account_id: bank.id });
  });
});
