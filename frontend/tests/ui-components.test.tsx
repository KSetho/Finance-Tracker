import { act, render, renderHook, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDialog } from "../src/components/ui/ConfirmDialog";
import { DateField } from "../src/components/ui/DateField";
import { EmptyState } from "../src/components/ui/EmptyState";
import { MoneyField } from "../src/components/ui/MoneyField";
import { Segmented } from "../src/components/ui/Segmented";
import { Select } from "../src/components/ui/Select";
import { Sheet } from "../src/components/ui/Sheet";
import { Skeleton } from "../src/components/ui/Skeleton";
import { useIdempotentId } from "../src/hooks/useIdempotentId";
import { useLastAccount } from "../src/hooks/useLastAccount";

beforeEach(() => localStorage.clear());

describe("MoneyField", () => {
  it("asks for the decimal keypad and filters what is typed", async () => {
    render(<MoneyField label="Amount" />);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("inputmode", "decimal");
    expect(input).toHaveAttribute("autocomplete", "off");
    await userEvent.setup().type(input, "ab12.345x6");
    expect(input).toHaveValue("12.34");
  });

  it("shows its error linked to the input", () => {
    render(<MoneyField label="Amount" error="Enter an amount" />);
    const input = screen.getByLabelText("Amount");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAccessibleDescription("Enter an amount");
  });
});

describe("Select and DateField", () => {
  it("renders a native select and an accessible calendar sheet", async () => {
    render(
      <>
        <Select label="Account">
          <option value="a">Bank</option>
        </Select>
        <DateField label="Date" />
      </>,
    );
    expect(screen.getByLabelText("Account").tagName).toBe("SELECT");
    await userEvent.setup().click(screen.getByRole("button", { name: "Open Date calendar" }));
    expect(screen.getByRole("dialog", { name: "Choose date" })).toBeInTheDocument();
    expect(screen.getByRole("grid")).toBeInTheDocument();
  });
});

describe("Segmented", () => {
  function Harness({ onChange }: { onChange: (v: string) => void }) {
    const [value, setValue] = useState("a");
    return (
      <Segmented
        label="Kind"
        value={value}
        onChange={(v) => {
          setValue(v);
          onChange(v);
        }}
        options={[
          { value: "a", label: "Expense" },
          { value: "b", label: "Income" },
          { value: "c", label: "Transfer" },
        ]}
      />
    );
  }

  it("is a radiogroup operated with arrow keys", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    expect(screen.getByRole("radiogroup", { name: "Kind" })).toBeInTheDocument();
    const user = userEvent.setup();
    const first = screen.getByRole("radio", { name: "Expense" });
    expect(first).toHaveAttribute("aria-checked", "true");
    first.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("b");
    expect(screen.getByRole("radio", { name: "Income" })).toHaveFocus();
    await user.keyboard("{ArrowLeft}{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("selects on tap", async () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Transfer" }));
    expect(onChange).toHaveBeenCalledWith("c");
  });
});

describe("ConfirmDialog", () => {
  it("traps focus, closes on Escape and confirms once even when tapped twice", async () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <ConfirmDialog
        open
        title="Delete this entry?"
        message="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    const dialog = screen.getByRole("dialog", { name: "Delete this entry?" });
    const user = userEvent.setup();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Delete" })).toHaveFocus();
    await user.tab();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);

    const confirm = within(dialog).getByRole("button", { name: "Delete" });
    await user.click(confirm);
    await user.click(confirm);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("renders nothing when closed", () => {
    render(
      <ConfirmDialog open={false} title="t" confirmLabel="Ok" onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});

describe("Sheet", () => {
  it("focuses its first control and closes on Escape and backdrop tap", async () => {
    const onClose = vi.fn();
    render(
      <Sheet open title="Filters" onClose={onClose}>
        <button>First</button>
        <button>Second</button>
      </Sheet>,
    );
    const sheet = screen.getByRole("dialog", { name: "Filters" });
    expect(within(sheet).getByRole("button", { name: "First" })).toHaveFocus();
    const user = userEvent.setup();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(document.querySelector(".sheet-backdrop") as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("keeps Tab focus inside", async () => {
    render(
      <Sheet open title="Filters" onClose={vi.fn()}>
        <button>First</button>
        <button>Second</button>
      </Sheet>,
    );
    const sheet = within(screen.getByRole("dialog", { name: "Filters" }));
    const user = userEvent.setup();
    sheet.getByRole("button", { name: "Second" }).focus();
    await user.tab();
    expect(sheet.getByRole("button", { name: "First" })).toHaveFocus();
  });
});

describe("EmptyState and Skeleton", () => {
  it("shows the title, message and action", () => {
    render(<EmptyState title="No accounts yet" message="Add one." action={<button>Add</button>} />);
    expect(screen.getByText("No accounts yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add" })).toBeInTheDocument();
  });

  it("announces loading once and hides the placeholder blocks", () => {
    render(<Skeleton label="Loading accounts" lines={3} />);
    const status = screen.getByRole("status", { name: "Loading accounts" });
    expect(status.querySelectorAll("[aria-hidden='true']").length).toBe(3);
  });
});

describe("hooks", () => {
  it("useIdempotentId is stable until reset", () => {
    const { result, rerender } = renderHook(() => useIdempotentId());
    const first = result.current.id;
    expect(first).toMatch(/^[0-9a-f-]{36}$/);
    rerender();
    expect(result.current.id).toBe(first);
    act(() => result.current.reset());
    expect(result.current.id).not.toBe(first);
  });

  it("useLastAccount remembers the account in localStorage", () => {
    const { result } = renderHook(() => useLastAccount());
    expect(result.current.lastAccountId).toBeNull();
    act(() => result.current.remember("acct-1"));
    expect(result.current.lastAccountId).toBe("acct-1");
    expect(localStorage.getItem("finance.lastAccountId")).toBe("acct-1");
    const again = renderHook(() => useLastAccount());
    expect(again.result.current.lastAccountId).toBe("acct-1");
  });
});
