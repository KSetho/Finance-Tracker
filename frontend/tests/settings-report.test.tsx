import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { signedIn } from "./helpers";
import { renderApp } from "./renderApp";
import { server } from "./server";

beforeEach(() => {
  signedIn();
});

describe("settings transaction CSV report", () => {
  it("emails a report for the chosen date range", async () => {
    let body: unknown;
    server.use(
      http.post("/api/v1/reports/transactions-csv", async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          { message: "Your transaction CSV report was sent to your email." },
          { status: 202 },
        );
      }),
    );

    renderApp("/settings");
    const user = userEvent.setup();

    expect(
      await screen.findByRole("heading", { name: /email transaction report/i }),
    ).toBeInTheDocument();

    // DateField uses a hidden/native-ish value via the accessible control — set via labels.
    const from = screen.getByLabelText(/^from$/i);
    const to = screen.getByLabelText(/^to$/i);
    await user.clear(from);
    await user.type(from, "2026-10-01");
    await user.clear(to);
    await user.type(to, "2026-10-31");

    await user.click(screen.getByRole("button", { name: /email csv report/i }));

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/sent to your email/i);
    });
    expect(body).toEqual({ start_date: "2026-10-01", end_date: "2026-10-31" });
  });
});
