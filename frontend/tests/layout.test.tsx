import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { beforeEach, describe, expect, it } from "vitest";
import { renderApp } from "./renderApp";
import { server } from "./server";

const session = {
  user: { id: "11111111-1111-1111-1111-111111111111", email: "owner@example.com" },
  csrf_token: "csrf-1",
  expires_at: "2026-10-24T12:00:00Z",
};

beforeEach(() => {
  server.use(http.get("/api/v1/auth/me", () => HttpResponse.json(session)));
});

describe("protected layout", () => {
  it("shows the owner email", async () => {
    renderApp("/dashboard");
    expect(await screen.findByText("owner@example.com")).toBeInTheDocument();
  });

  describe("desktop sidebar", () => {
    it("has every destination, an Add transaction action and Logout", async () => {
      renderApp("/dashboard");
      const sidebar = await screen.findByRole("navigation", { name: /main/i });
      for (const label of ["Dashboard", "Transactions", "Accounts", "Monthly budget", "Settings"]) {
        expect(within(sidebar).getByRole("link", { name: label })).toBeInTheDocument();
      }
      expect(within(sidebar).getByRole("link", { name: "Add transaction" })).toHaveAttribute(
        "href",
        "/transactions/new",
      );
      expect(within(sidebar).getByRole("button", { name: /logout/i })).toBeInTheDocument();
    });

    it("is reachable by keyboard in reading order", async () => {
      renderApp("/dashboard");
      const sidebar = await screen.findByRole("navigation", { name: /main/i });
      const user = userEvent.setup();
      within(sidebar).getByRole("link", { name: "Dashboard" }).focus();
      await user.tab();
      expect(within(sidebar).getByRole("link", { name: "Transactions" })).toHaveFocus();
    });

    it("navigates between placeholder pages", async () => {
      renderApp("/dashboard");
      const sidebar = await screen.findByRole("navigation", { name: /main/i });
      await userEvent.setup().click(within(sidebar).getByRole("link", { name: "Accounts" }));
      expect(await screen.findByRole("heading", { name: /accounts/i })).toBeInTheDocument();
    });
  });

  describe("mobile tab bar", () => {
    async function mobileNav(path = "/dashboard") {
      renderApp(path);
      return within(await screen.findByRole("navigation", { name: /mobile/i }));
    }

    it("keeps to five thumb-sized slots and leaves Logout out of the tab bar", async () => {
      const nav = await mobileNav();
      expect(nav.getAllByRole("link")).toHaveLength(4);
      expect(nav.getAllByRole("button")).toHaveLength(1);
      expect(nav.getByRole("link", { name: "Home" })).toHaveAttribute("href", "/dashboard");
      expect(nav.getByRole("link", { name: "History" })).toHaveAttribute("href", "/transactions");
      expect(nav.getByRole("link", { name: "Add transaction" })).toHaveAttribute(
        "href",
        "/transactions/new",
      );
      expect(nav.getByRole("link", { name: "Accounts" })).toBeInTheDocument();
      expect(nav.getByRole("button", { name: "More" })).toBeInTheDocument();
      expect(nav.queryByRole("button", { name: /logout/i })).not.toBeInTheDocument();
    });

    it("marks only the current tab, so Add does not also highlight Transactions", async () => {
      const nav = await mobileNav("/transactions/new");
      expect(nav.getByRole("link", { name: "Add transaction" })).toHaveAttribute(
        "aria-current",
        "page",
      );
      expect(nav.getByRole("link", { name: "History" })).not.toHaveAttribute("aria-current");
    });

    it("keeps tab labels short enough for five columns on a 320px phone", async () => {
      const nav = await mobileNav();
      const labels = [...nav.getAllByRole("link"), ...nav.getAllByRole("button")].map(
        (item) => item.querySelector("span:last-child")?.textContent ?? "",
      );
      expect(labels).toEqual(["Home", "History", "Add", "Accounts", "More"]);
      for (const label of labels) expect(label.length).toBeLessThanOrEqual(9);
    });

    it("opens a More sheet with the secondary destinations and Logout", async () => {
      const nav = await mobileNav();
      const more = nav.getByRole("button", { name: "More" });
      expect(more).toHaveAttribute("aria-expanded", "false");
      await userEvent.setup().click(more);

      const sheet = within(screen.getByRole("dialog", { name: "More" }));
      expect(more).toHaveAttribute("aria-expanded", "true");
      expect(sheet.getByRole("link", { name: "Monthly budget" })).toHaveFocus();
      expect(sheet.getByRole("link", { name: "Settings" })).toBeInTheDocument();
      expect(sheet.getByRole("button", { name: /logout/i })).toBeInTheDocument();
      expect(sheet.getByText("owner@example.com")).toBeInTheDocument();
    });

    it("closes on Escape and returns focus to the More button", async () => {
      const nav = await mobileNav();
      const user = userEvent.setup();
      const more = nav.getByRole("button", { name: "More" });
      await user.click(more);
      await user.keyboard("{Escape}");
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      expect(more).toHaveFocus();
    });

    it("closes when the backdrop is tapped", async () => {
      const nav = await mobileNav();
      const user = userEvent.setup();
      await user.click(nav.getByRole("button", { name: "More" }));
      await user.click(document.querySelector(".sheet-backdrop") as HTMLElement);
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("keeps Tab focus inside the open sheet", async () => {
      const nav = await mobileNav();
      const user = userEvent.setup();
      await user.click(nav.getByRole("button", { name: "More" }));
      const sheet = within(screen.getByRole("dialog", { name: "More" }));
      sheet.getByRole("button", { name: /logout/i }).focus();
      await user.tab();
      expect(sheet.getByRole("link", { name: "Monthly budget" })).toHaveFocus();
      await user.tab({ shift: true });
      expect(sheet.getByRole("button", { name: /logout/i })).toHaveFocus();
    });

    it("closes after navigating from the sheet", async () => {
      const nav = await mobileNav();
      const user = userEvent.setup();
      await user.click(nav.getByRole("button", { name: "More" }));
      await user.click(
        within(screen.getByRole("dialog", { name: "More" })).getByRole("link", { name: "Settings" }),
      );
      expect(await screen.findByRole("heading", { name: "Settings" })).toBeInTheDocument();
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
