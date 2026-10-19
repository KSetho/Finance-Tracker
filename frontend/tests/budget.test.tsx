import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { delay, http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { currentMonth, monthLabel, shiftMonth } from "../src/lib/dates";
import { apiError, signedIn } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

const NOW = currentMonth();
const LAST = shiftMonth(NOW, -1);

type Summary = {
  month: string;
  allowance: string | null;
  total_expenses: string;
  remaining: string | null;
  percentage_used: string | null;
  is_over_budget: boolean;
};

const summary = (overrides: Partial<Summary> = {}): Summary => ({
  month: NOW,
  allowance: "3000.00",
  total_expenses: "1200.00",
  remaining: "1800.00",
  percentage_used: "40.00",
  is_over_budget: false,
  ...overrides,
});

const pathFor = (month: string) => {
  const [year, mon] = month.split("-");
  return `/api/v1/budgets/${year}/${Number(mon)}`;
};

function budgetHandlers(byMonth: Record<string, Summary>) {
  server.use(
    http.get("/api/v1/budgets/:year/:month", ({ params }) => {
      const month = `${params.year}-${String(params.month).padStart(2, "0")}`;
      return HttpResponse.json(
        byMonth[month] ?? summary({ month, allowance: null, total_expenses: "0.00", remaining: null, percentage_used: null }),
      );
    }),
    http.get("/api/v1/budgets", () => HttpResponse.json({ items: Object.values(byMonth) })),
  );
}

beforeEach(() => signedIn());

describe("budget screen", () => {
  it("shows the month, allowance, spent, remaining and percentage used", async () => {
    budgetHandlers({ [NOW]: summary() });
    renderApp("/budget");
    expect(await screen.findByRole("heading", { name: "Monthly budget" })).toBeInTheDocument();
    expect(await screen.findByText(monthLabel(NOW), { selector: "[data-testid='month-label']" })).toBeInTheDocument();
    const cards = await screen.findByRole("group", { name: "This month" });
    expect(within(cards).getByText("GH₵ 3,000.00")).toBeInTheDocument();
    expect(within(cards).getByText("GH₵ 1,200.00")).toBeInTheDocument();
    expect(within(cards).getByText("GH₵ 1,800.00")).toBeInTheDocument();
    expect(within(cards).getByText("40.00%")).toBeInTheDocument();
  });

  it("says so in words when spending is over the allowance, not only in colour", async () => {
    budgetHandlers({
      [NOW]: summary({
        total_expenses: "3200.00",
        remaining: "-200.00",
        percentage_used: "106.67",
        is_over_budget: true,
      }),
    });
    renderApp("/budget");
    expect(await screen.findByText("Over by GH₵ 200.00")).toBeInTheDocument();
    expect(screen.getByText("-GH₵ 200.00")).toBeInTheDocument();
    expect(screen.getByText("106.67%")).toBeInTheDocument();
  });

  it("shows 'No allowance set' and N/A when none is set", async () => {
    budgetHandlers({
      [NOW]: summary({ allowance: null, remaining: null, percentage_used: null, total_expenses: "250.00" }),
    });
    renderApp("/budget");
    expect(await screen.findByText("No allowance set")).toBeInTheDocument();
    expect(screen.getByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("GH₵ 250.00")).toBeInTheDocument();
  });

  it("shows N/A for a zero allowance", async () => {
    budgetHandlers({
      [NOW]: summary({ allowance: "0.00", remaining: "-100.00", percentage_used: null, total_expenses: "100.00", is_over_budget: true }),
    });
    renderApp("/budget");
    expect(await screen.findByText("N/A")).toBeInTheDocument();
    expect(screen.getByText("Over by GH₵ 100.00")).toBeInTheDocument();
  });

  it("shows a loading placeholder and an error with retry", async () => {
    let calls = 0;
    server.use(
      http.get("/api/v1/budgets/:year/:month", async () => {
        calls += 1;
        await delay(50);
        if (calls === 1) return apiError("internal_error", "boom", 500);
        return HttpResponse.json(summary());
      }),
      http.get("/api/v1/budgets", () => HttpResponse.json({ items: [] })),
    );
    renderApp("/budget");
    expect(await screen.findByRole("status", { name: "Loading budget" })).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not load the budget.");
    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("GH₵ 3,000.00")).toBeInTheDocument();
  });
});

describe("month picker", () => {
  it("moves between months and loads each one", async () => {
    const requested: string[] = [];
    server.use(
      http.get("/api/v1/budgets/:year/:month", ({ params }) => {
        const month = `${params.year}-${String(params.month).padStart(2, "0")}`;
        requested.push(month);
        return HttpResponse.json(summary({ month }));
      }),
      http.get("/api/v1/budgets", () => HttpResponse.json({ items: [] })),
    );
    renderApp("/budget");
    const user = userEvent.setup();
    await screen.findByTestId("month-label");
    await user.click(screen.getByRole("button", { name: "Previous month" }));
    await waitFor(() => expect(screen.getByTestId("month-label")).toHaveTextContent(monthLabel(LAST)));
    expect(requested).toEqual(expect.arrayContaining([NOW, LAST]));
    await user.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => expect(screen.getByTestId("month-label")).toHaveTextContent(monthLabel(NOW)));
  });
});

describe("allowance form", () => {
  it("saves the allowance and shows the new figures only after the server confirms", async () => {
    let allowance: string | null = null;
    let body: Record<string, unknown> | undefined;
    server.use(
      http.get("/api/v1/budgets/:year/:month", () =>
        HttpResponse.json(
          allowance
            ? summary({ allowance, remaining: "2800.00", percentage_used: "6.67", total_expenses: "200.00" })
            : summary({ allowance: null, remaining: null, percentage_used: null, total_expenses: "200.00" }),
        ),
      ),
      http.get("/api/v1/budgets", () => HttpResponse.json({ items: [] })),
      http.put(pathFor(NOW), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        allowance = body.allowance as string;
        return HttpResponse.json(summary({ allowance, remaining: "2800.00", percentage_used: "6.67", total_expenses: "200.00" }));
      }),
    );
    renderApp("/budget");
    const user = userEvent.setup();
    await screen.findByText("No allowance set");
    await user.type(screen.getByLabelText("Monthly allowance"), "3000");
    await user.click(screen.getByRole("button", { name: "Save allowance" }));
    expect(await screen.findByText("GH₵ 2,800.00")).toBeInTheDocument();
    expect(body).toEqual({ allowance: "3000.00" });
    expect(screen.getByRole("status", { name: "Allowance saved" })).toBeInTheDocument();
  });

  it("asks for an amount, allows zero and only lets two decimals be typed", async () => {
    let body: Record<string, unknown> | undefined;
    budgetHandlers({ [NOW]: summary({ allowance: null, remaining: null, percentage_used: null }) });
    server.use(
      http.put(pathFor(NOW), async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(summary({ allowance: "0.00" }));
      }),
    );
    renderApp("/budget");
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Monthly allowance");
    await user.click(screen.getByRole("button", { name: "Save allowance" }));
    expect(await screen.findByText("Enter an amount")).toBeInTheDocument();
    expect(body).toBeUndefined();
    await user.type(field, "12.345");
    expect(field).toHaveValue("12.34");
    await user.clear(field);
    await user.type(field, "0");
    await user.click(screen.getByRole("button", { name: "Save allowance" }));
    await waitFor(() => expect(body).toEqual({ allowance: "0.00" }));
  });

  it("prefills the current allowance and shows a failed save without losing the value", async () => {
    budgetHandlers({ [NOW]: summary() });
    server.use(http.put(pathFor(NOW), () => apiError("internal_error", "Server error", 500)));
    renderApp("/budget");
    const user = userEvent.setup();
    const field = await screen.findByLabelText("Monthly allowance");
    await waitFor(() => expect(field).toHaveValue("3000.00"));
    await user.click(screen.getByRole("button", { name: "Save allowance" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(field).toHaveValue("3000.00");
  });
});

describe("recent months", () => {
  it("lists months and switches to the one tapped", async () => {
    budgetHandlers({
      [NOW]: summary(),
      [LAST]: summary({ month: LAST, allowance: "2500.00", total_expenses: "2600.00", remaining: "-100.00", percentage_used: "104.00", is_over_budget: true }),
    });
    renderApp("/budget");
    const user = userEvent.setup();
    const list = await screen.findByRole("list", { name: "Recent months" });
    const row = within(list).getByRole("button", { name: new RegExp(monthLabel(LAST)) });
    expect(row).toHaveTextContent("GH₵ 2,600.00");
    expect(row).toHaveTextContent("Over");
    await user.click(row);
    await waitFor(() => expect(screen.getByTestId("month-label")).toHaveTextContent(monthLabel(LAST)));
  });
});
