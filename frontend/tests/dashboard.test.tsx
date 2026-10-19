import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { currentMonth, monthBounds, monthLabel, shiftMonth } from "../src/lib/dates";
import { apiError, bank, cash, categories, momo, signedIn, transaction } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

const NOW = currentMonth();
const LAST = shiftMonth(NOW, -1);

type Budget = {
  month: string;
  allowance: string | null;
  total_expenses: string;
  remaining: string | null;
  percentage_used: string | null;
  is_over_budget: boolean;
};

const budget = (overrides: Partial<Budget> = {}): Budget => ({
  month: NOW,
  allowance: "1000.00",
  total_expenses: "195.00",
  remaining: "805.00",
  percentage_used: "19.50",
  is_over_budget: false,
  ...overrides,
});

const summary = (month = NOW, overrides: Record<string, unknown> = {}) => ({
  month,
  currency: "GHS",
  total_income: "3000.00",
  total_expenses: "195.00",
  fee_total: "5.00",
  net_cash_flow: "2805.00",
  budget: budget({ month }),
  combined_balance: "5195.00",
  accounts: [
    { ...bank, balance: "4350.00" },
    { ...momo, balance: "345.00" },
    { ...cash, balance: "500.00" },
  ],
  ...overrides,
});

const spending = {
  total_expenses: "195.00",
  items: [
    { category_id: categories.food.id, name: "Food", amount: "150.00", share_percent: "76.92" },
    { category_id: categories.transport.id, name: "Transport", amount: "40.00", share_percent: "20.51" },
    { category_id: categories.fees.id, name: "Fees", amount: "5.00", share_percent: "2.57" },
  ],
};

const cashFlow = {
  group_by: "day",
  income: "3000.00",
  expenses: "195.00",
  net: "2805.00",
  buckets: [
    { period: `${NOW}-01`, income: "3000.00", expenses: "0.00" },
    { period: `${NOW}-05`, income: "0.00", expenses: "5.00" },
  ],
};

type Seen = { summary: string[]; spending: Record<string, string>[]; cashFlow: Record<string, string>[] };

function dashboardHandlers(overrides: Partial<{ summary: unknown; spending: unknown; cashFlow: unknown; recent: unknown[] }> = {}): Seen {
  const seen: Seen = { summary: [], spending: [], cashFlow: [] };
  server.use(
    http.get("/api/v1/dashboard/summary", ({ request }) => {
      const month = new URL(request.url).searchParams.get("month") ?? NOW;
      seen.summary.push(month);
      return HttpResponse.json(overrides.summary ?? summary(month));
    }),
    http.get("/api/v1/dashboard/spending-by-category", ({ request }) => {
      seen.spending.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(overrides.spending ?? spending);
    }),
    http.get("/api/v1/dashboard/cash-flow", ({ request }) => {
      seen.cashFlow.push(Object.fromEntries(new URL(request.url).searchParams));
      return HttpResponse.json(overrides.cashFlow ?? cashFlow);
    }),
    http.get("/api/v1/dashboard/recent-transactions", () =>
      HttpResponse.json({ items: overrides.recent ?? [transaction()] }),
    ),
  );
  return seen;
}

beforeEach(() => signedIn());

describe("headline figures", () => {
  it("shows income, expenses, fees, net cash flow and the combined balance", async () => {
    dashboardHandlers();
    renderApp("/dashboard");
    const cards = await screen.findByRole("group", { name: "Month summary" });
    expect(within(cards).getByText("Income")).toBeInTheDocument();
    expect(within(cards).getByText("GH₵ 3,000.00")).toBeInTheDocument();
    expect(within(cards).getByText("GH₵ 195.00")).toBeInTheDocument();
    expect(within(cards).getByText("GH₵ 5.00")).toBeInTheDocument();
    expect(within(cards).getByText("Included in expenses")).toBeInTheDocument();
    expect(within(cards).getByText("GH₵ 2,805.00")).toBeInTheDocument();
    expect(screen.getByText("GH₵ 5,195.00")).toBeInTheDocument();
  });

  it("lists every account's balance", async () => {
    dashboardHandlers();
    renderApp("/dashboard");
    const list = await screen.findByRole("list", { name: "Account balances" });
    expect(within(list).getByText("Bank")).toBeInTheDocument();
    expect(within(list).getByText("GH₵ 4,350.00")).toBeInTheDocument();
    expect(within(list).getByText("GH₵ 345.00")).toBeInTheDocument();
    expect(within(list).getByText("GH₵ 500.00")).toBeInTheDocument();
  });

  it("shows how much allowance is left, or says there is none, or says it is over", async () => {
    dashboardHandlers();
    const { unmount } = renderApp("/dashboard");
    const card = await screen.findByRole("group", { name: "Allowance" });
    expect(within(card).getByText("GH₵ 805.00")).toBeInTheDocument();
    expect(within(card).getByText(/19\.50% of GH₵ 1,000\.00 used/)).toBeInTheDocument();
    unmount();

    dashboardHandlers({
      summary: summary(NOW, {
        budget: budget({ allowance: null, remaining: null, percentage_used: null }),
      }),
    });
    const second = renderApp("/dashboard");
    expect(await screen.findByText("No allowance set")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Set an allowance" })).toHaveAttribute("href", "/budget");
    second.unmount();

    dashboardHandlers({
      summary: summary(NOW, {
        budget: budget({ total_expenses: "1200.00", remaining: "-200.00", percentage_used: "120.00", is_over_budget: true }),
      }),
    });
    renderApp("/dashboard");
    expect(await screen.findByText("Over by GH₵ 200.00")).toBeInTheDocument();
  });

  it("reloads every figure for the month the owner picks", async () => {
    const seen = dashboardHandlers();
    renderApp("/dashboard");
    const user = userEvent.setup();
    await screen.findByRole("group", { name: "Month summary" });
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByTestId("month-label")).toHaveTextContent(monthLabel(LAST)));
    await waitFor(() => expect(seen.summary).toContain(LAST));
    await waitFor(() => expect(seen.spending.some((p) => p.month === LAST)).toBe(true));
    const bounds = monthBounds(LAST);
    await waitFor(() =>
      expect(seen.cashFlow.some((p) => p.start_date === bounds.start && p.end_date === bounds.end)).toBe(true),
    );
  });
});

describe("spending by category", () => {
  it("shows a chart with a plain list of name, amount and share beneath it", async () => {
    dashboardHandlers();
    renderApp("/dashboard");
    expect(await screen.findByRole("heading", { name: "Spending by category" })).toBeInTheDocument();
    expect(await screen.findByRole("img", { name: "Spending by category chart" })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: "Spending by category" });
    const food = within(list).getByText("Food").closest("li")!;
    expect(food).toHaveTextContent("GH₵ 150.00");
    expect(food).toHaveTextContent("76.92%");
    expect(within(list).getByText("Fees")).toBeInTheDocument(); // fees are their own category
  });

  it("says so when nothing was spent", async () => {
    dashboardHandlers({ spending: { total_expenses: "0.00", items: [] } });
    renderApp("/dashboard");
    expect(await screen.findByText("No spending this month")).toBeInTheDocument();
  });
});

describe("income and expenses over time", () => {
  it("shows the totals as text and offers this month or the last three", async () => {
    const seen = dashboardHandlers();
    renderApp("/dashboard");
    const totals = await screen.findByRole("group", { name: "Income and expenses totals" });
    expect(within(totals).getByText("GH₵ 3,000.00")).toBeInTheDocument();
    expect(within(totals).getByText("GH₵ 195.00")).toBeInTheDocument();
    expect(within(totals).getByText("GH₵ 2,805.00")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Income and expenses chart" })).toBeInTheDocument();

    await userEvent.setup().click(screen.getByRole("radio", { name: "Last 3 months" }));
    const start = monthBounds(shiftMonth(NOW, -2)).start;
    const end = monthBounds(NOW).end;
    await waitFor(() =>
      expect(seen.cashFlow.some((p) => p.start_date === start && p.end_date === end)).toBe(true),
    );
  });

  it("says so when there is nothing to chart", async () => {
    dashboardHandlers({
      cashFlow: { group_by: "day", income: "0.00", expenses: "0.00", net: "0.00", buckets: [] },
    });
    renderApp("/dashboard");
    expect(await screen.findByText("No income or expenses in this period")).toBeInTheDocument();
  });
});

describe("recent transactions", () => {
  it("lists the latest entries, each opening its detail, with a link to all of them", async () => {
    const fee = transaction({ id: "tttttttt-0000-0000-0000-0000000000f1", name: "Fee: Bank to MoMo", is_fee: true });
    dashboardHandlers({ recent: [transaction(), fee] });
    renderApp("/dashboard");
    const first = await screen.findByRole("link", { name: /groceries/i });
    expect(first).toHaveAttribute("href", expect.stringMatching(/^\/transactions\//));
    expect(screen.getByRole("link", { name: /fee for bank to momo/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See all" })).toHaveAttribute("href", "/transactions");
  });

  it("shows an empty state", async () => {
    dashboardHandlers({ recent: [] });
    renderApp("/dashboard");
    expect(await screen.findByText("No transactions yet")).toBeInTheDocument();
  });
});

describe("loading and errors", () => {
  it("shows a placeholder per section while loading", async () => {
    server.use(
      http.get("/api/v1/dashboard/summary", async () => {
        await delay(100);
        return HttpResponse.json(summary());
      }),
      http.get("/api/v1/dashboard/spending-by-category", async () => {
        await delay(100);
        return HttpResponse.json(spending);
      }),
      http.get("/api/v1/dashboard/cash-flow", async () => {
        await delay(100);
        return HttpResponse.json(cashFlow);
      }),
      http.get("/api/v1/dashboard/recent-transactions", async () => {
        await delay(100);
        return HttpResponse.json({ items: [] });
      }),
    );
    renderApp("/dashboard");
    expect(await screen.findByRole("status", { name: "Loading summary" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading spending" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading income and expenses" })).toBeInTheDocument();
    expect(screen.getByRole("status", { name: "Loading recent transactions" })).toBeInTheDocument();
  });

  it("a failing section shows its own retry and leaves the others working", async () => {
    let calls = 0;
    dashboardHandlers();
    server.use(
      http.get("/api/v1/dashboard/spending-by-category", () => {
        calls += 1;
        if (calls === 1) return apiError("internal_error", "boom", 500);
        return HttpResponse.json(spending);
      }),
    );
    renderApp("/dashboard");
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load spending by category.");
    expect(await screen.findByRole("group", { name: "Month summary" })).toBeInTheDocument(); // still there
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("list", { name: "Spending by category" })).toBeInTheDocument();
  });
});
