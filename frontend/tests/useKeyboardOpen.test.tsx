import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { useKeyboardOpen } from "../src/hooks/useKeyboardOpen";

function Probe() {
  const open = useKeyboardOpen();
  return (
    <div>
      <p data-testid="state">{open ? "open" : "closed"}</p>
      <input aria-label="text field" />
      <input type="checkbox" aria-label="check" />
      <button>plain button</button>
    </div>
  );
}

describe("useKeyboardOpen", () => {
  it("is open only while a text-entry control has focus", async () => {
    render(<Probe />);
    const user = userEvent.setup();
    expect(screen.getByTestId("state")).toHaveTextContent("closed");

    await user.click(screen.getByLabelText("text field"));
    expect(screen.getByTestId("state")).toHaveTextContent("open");

    await user.click(screen.getByRole("button", { name: "plain button" }));
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });

  it("ignores checkboxes and buttons", async () => {
    render(<Probe />);
    await act(async () => screen.getByLabelText("check").focus());
    expect(screen.getByTestId("state")).toHaveTextContent("closed");
  });
});
