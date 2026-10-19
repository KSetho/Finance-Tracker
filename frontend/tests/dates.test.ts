import { describe, expect, it } from "vitest";
import { accraToday, currentMonth, formatDate, monthLabel, shiftMonth } from "../src/lib/dates";

describe("dates", () => {
  it("formats as DD MMM YYYY", () => {
    expect(formatDate("2026-10-07")).toBe("07 Oct 2026");
    expect(formatDate("2026-01-31")).toBe("31 Jan 2026");
  });

  it("uses Ghana time for today, whatever the device zone", () => {
    expect(accraToday(new Date("2026-10-31T23:30:00Z"))).toBe("2026-10-31");
    expect(accraToday(new Date("2026-11-01T00:05:00Z"))).toBe("2026-11-01");
  });

  it("derives the current month", () => {
    expect(currentMonth(new Date("2026-10-17T12:00:00Z"))).toBe("2026-10");
  });

  it("shifts months across year boundaries", () => {
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-10", 0)).toBe("2026-10");
  });

  it("labels months", () => {
    expect(monthLabel("2026-10")).toBe("October 2026");
    expect(monthLabel("2027-01")).toBe("January 2027");
  });
});
