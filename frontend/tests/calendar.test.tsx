import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { describe, expect, it, vi } from "vitest";
import { CalendarGrid } from "../src/components/CalendarGrid";
import { currentMonth, formatDate } from "../src/lib/dates";
import { financeHandlers, signedIn } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

const MONTH = currentMonth();
const DAY = `${MONTH}-19`;

describe("CalendarGrid", () => {
  it("uses a Monday-first grid and supports pointer and keyboard selection", async () => {
    const onSelect = vi.fn();
    render(
      <CalendarGrid
        month="2026-10"
        selected="2026-10-14"
        today="2026-10-19"
        onSelect={onSelect}
      />,
    );
    expect(screen.getAllByRole("columnheader").map((item) => item.textContent)).toEqual([
      "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun",
    ]);
    const day14 = screen.getByRole("gridcell", { name: "14" });
    expect(day14).toHaveAttribute("aria-selected", "true");
    await userEvent.setup().click(day14);
    expect(onSelect).toHaveBeenCalledWith("2026-10-14");

    day14.focus();
    await userEvent.setup().keyboard("{ArrowRight}");
    expect(screen.getByRole("gridcell", { name: "15" })).toHaveFocus();
  });

  it("honours minimum and maximum dates", () => {
    render(
      <CalendarGrid month="2026-10" min="2026-10-10" max="2026-10-20" onSelect={vi.fn()} />,
    );
    expect(screen.getByRole("gridcell", { name: "9" })).toBeDisabled();
    expect(screen.getByRole("gridcell", { name: "20" })).toBeEnabled();
    expect(screen.getByRole("gridcell", { name: "21" })).toBeDisabled();
  });

  it("opens a daily drilldown and offers a date-prefilled transaction", async () => {
    signedIn();
    financeHandlers();
    server.use(
      http.get("/api/v1/dashboard/calendar", () =>
        HttpResponse.json({
          month: MONTH,
          days: [
            {
              date: DAY,
              income: "0.00",
              expenses: "0.00",
              net: "0.00",
              transaction_count: 1,
            },
          ],
        }),
      ),
    );
    renderApp("/calendar");
    const user = userEvent.setup();
    await user.click(await screen.findByRole("gridcell", { name: /19 1 transactions/i }));
    const dialog = screen.getByRole("dialog", { name: formatDate(DAY) });
    expect(dialog).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Add transaction" })).toHaveAttribute(
      "href",
      `/transactions/new?date=${DAY}`,
    );
  });
});

