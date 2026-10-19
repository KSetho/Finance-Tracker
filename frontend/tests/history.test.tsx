import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
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
  signedIn();
  financeHandlers();
});

const groceries = transaction();
const salary = transaction({
  id: "tttttttt-0000-0000-0000-000000000002",
  type: "income",
  name: "October salary",
  amount: "3000.00",
  transaction_date: "2026-10-01",
  category: categories.salary,
});

type Query = Record<string, string>;

function listHandler(pages: Array<{ items: unknown[]; total: number }>, queries: Query[] = []) {
  server.use(
    http.get("/api/v1/transactions", ({ request }) => {
      const params = Object.fromEntries(new URL(request.url).searchParams) as Query;
      queries.push(params);
      const index = Math.min(Number(params.page ?? "1") - 1, pages.length - 1);
      return HttpResponse.json({
        items: pages[index].items,
        page: Number(params.page ?? "1"),
        page_size: Number(params.page_size ?? "20"),
        total: pages[index].total,
      });
    }),
  );
  return queries;
}

describe("history list", () => {
  it("shows what each entry is without relying on colour", async () => {
    listHandler([{ items: [groceries, salary], total: 2 }]);
    renderApp("/transactions");
    const expense = await screen.findByRole("link", { name: /groceries/i });
    expect(within(expense).getByText("-GH₵ 150.00")).toBeInTheDocument();
    expect(within(expense).getByText(/14 Oct 2026/)).toBeInTheDocument();
    expect(within(expense).getByText(/Bank/)).toBeInTheDocument();
    expect(within(expense).getByText(/Food/)).toBeInTheDocument();
    expect(within(expense).getByText(/Expense/)).toBeInTheDocument();
    const income = screen.getByRole("link", { name: /october salary/i });
    expect(within(income).getByText("+GH₵ 3,000.00")).toBeInTheDocument();
    expect(within(income).getByText(/Income/)).toBeInTheDocument();
  });

  it("shows a loading placeholder, then the rows", async () => {
    server.use(
      http.get("/api/v1/transactions", async () => {
        await delay(100);
        return HttpResponse.json({ items: [groceries], page: 1, page_size: 20, total: 1 });
      }),
    );
    renderApp("/transactions");
    expect(await screen.findByRole("status", { name: "Loading transactions" })).toBeInTheDocument();
    expect(await screen.findByRole("link", { name: /groceries/i })).toBeInTheDocument();
  });

  it("leads to adding the first transaction when there are none", async () => {
    listHandler([{ items: [], total: 0 }]);
    renderApp("/transactions");
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add a transaction" })).toHaveAttribute(
      "href",
      "/transactions/new",
    );
  });

  it("shows an error banner and recovers on retry", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/transactions", () => {
        calls += 1;
        if (calls === 1) return apiError("internal_error", "boom", 500);
        return HttpResponse.json({ items: [groceries], page: 1, page_size: 20, total: 1 });
      }),
    );
    renderApp("/transactions");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load transactions.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("link", { name: /groceries/i })).toBeInTheDocument();
  });

  it("opens the detail screen when a row is tapped", async () => {
    listHandler([{ items: [groceries], total: 1 }]);
    server.use(http.get(`/api/v1/transactions/${groceries.id}`, () => HttpResponse.json(groceries)));
    renderApp("/transactions");
    await userEvent.setup().click(await screen.findByRole("link", { name: /groceries/i }));
    expect(await screen.findByRole("heading", { name: "Groceries" })).toBeInTheDocument();
  });
});

describe("search", () => {
  it("waits for a pause in typing before asking the server", async () => {
    const queries = listHandler([{ items: [groceries], total: 1 }]);
    renderApp("/transactions");
    await screen.findByRole("link", { name: /groceries/i });
    await userEvent.setup().type(screen.getByRole("searchbox", { name: "Search transactions" }), "gro");
    await waitFor(() => expect(queries.some((q) => q.q === "gro")).toBe(true));
    expect(queries.filter((q) => q.q !== undefined).map((q) => q.q)).toEqual(["gro"]);
  });

  it("shows a no-match state that clears the filters", async () => {
    const queries = listHandler([{ items: [], total: 0 }]);
    renderApp("/transactions");
    const user = userEvent.setup();
    await user.type(await screen.findByRole("searchbox", { name: "Search transactions" }), "zzz");
    expect(await screen.findByText("No matches")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));
    await waitFor(() => expect(queries[queries.length - 1].q).toBeUndefined());
    expect(screen.getByRole("searchbox", { name: "Search transactions" })).toHaveValue("");
  });
});

describe("filters", () => {
  async function applyFilters() {
    const queries = listHandler([{ items: [groceries], total: 1 }]);
    renderApp("/transactions");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: /groceries/i });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = within(screen.getByRole("dialog", { name: "Filters" }));
    await user.type(sheet.getByLabelText("From"), "2026-10-01");
    await user.type(sheet.getByLabelText("To"), "2026-10-31");
    await user.selectOptions(sheet.getByLabelText("Type"), "expense");
    await waitFor(() =>
      expect(within(screen.getByRole("dialog")).getAllByRole("option").length).toBeGreaterThan(8),
    );
    await user.selectOptions(sheet.getByLabelText("Category"), categories.food.id);
    await user.selectOptions(sheet.getByLabelText("Account"), momo.id);
    await user.click(sheet.getByRole("button", { name: "Apply filters" }));
    return { queries, user };
  }

  it("sends every chosen filter to the server and closes the sheet", async () => {
    const { queries } = await applyFilters();
    await waitFor(() => expect(queries[queries.length - 1].type).toBe("expense"));
    expect(queries[queries.length - 1]).toMatchObject({
      start_date: "2026-10-01",
      end_date: "2026-10-31",
      type: "expense",
      category_id: categories.food.id,
      account_id: momo.id,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the active filters as chips that can be removed one by one", async () => {
    const { queries, user } = await applyFilters();
    const chips = await screen.findByRole("list", { name: "Active filters" });
    expect(within(chips).getByText("Expense")).toBeInTheDocument();
    expect(within(chips).getByText("Food")).toBeInTheDocument();
    expect(within(chips).getByText("MoMo")).toBeInTheDocument();
    await user.click(within(chips).getByRole("button", { name: "Remove filter Food" }));
    await waitFor(() => expect(queries[queries.length - 1].category_id).toBeUndefined());
    expect(queries[queries.length - 1].type).toBe("expense");
  });

  it("clears everything from the sheet", async () => {
    const { queries, user } = await applyFilters();
    await user.click(screen.getByRole("button", { name: "Filters (5)" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Filters" })).getByRole("button", { name: "Clear all" }),
    );
    await waitFor(() => {
      const last = queries[queries.length - 1];
      expect(last.type).toBeUndefined();
      expect(last.account_id).toBeUndefined();
    });
  });

  it("offers sorting by date and amount", async () => {
    const queries = listHandler([{ items: [groceries], total: 1 }]);
    renderApp("/transactions");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: /groceries/i });
    await user.click(screen.getByRole("button", { name: "Filters" }));
    const sheet = within(screen.getByRole("dialog", { name: "Filters" }));
    await user.selectOptions(sheet.getByLabelText("Sort by"), "highest");
    await user.click(sheet.getByRole("button", { name: "Apply filters" }));
    await waitFor(() =>
      expect(queries[queries.length - 1]).toMatchObject({ sort_by: "amount", sort_order: "desc" }),
    );
  });
});

describe("paging", () => {
  it("loads the next page on request and hides the button when everything is shown", async () => {
    const second = transaction({ id: "tttttttt-0000-0000-0000-000000000003", name: "Taxi" });
    const queries = listHandler([
      { items: [groceries, salary], total: 3 },
      { items: [second], total: 3 },
    ]);
    renderApp("/transactions");
    const user = userEvent.setup();
    await screen.findByRole("link", { name: /groceries/i });
    expect(screen.queryByRole("link", { name: /taxi/i })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByRole("link", { name: /taxi/i })).toBeInTheDocument();
    expect(queries.map((q) => q.page)).toEqual(["1", "2"]);
    expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /groceries/i })).toBeInTheDocument(); // earlier rows stay
    expect(bank).toBeDefined();
  });
});
