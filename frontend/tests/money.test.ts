import { describe, expect, it } from "vitest";
import { formatGhs, isValidAmountInput, normalizeAmount } from "../src/lib/money";

describe("formatGhs", () => {
  it("groups thousands and always shows two decimals", () => {
    expect(formatGhs("1234.5")).toBe("GH₵ 1,234.50");
    expect(formatGhs("0")).toBe("GH₵ 0.00");
    expect(formatGhs("150.00")).toBe("GH₵ 150.00");
  });

  it("keeps small fractions exact (no float artifacts)", () => {
    expect(formatGhs("0.10")).toBe("GH₵ 0.10");
    expect(formatGhs("0.30")).toBe("GH₵ 0.30");
  });

  it("keeps every digit of large values", () => {
    expect(formatGhs("999999999999.99")).toBe("GH₵ 999,999,999,999.99");
  });

  it("shows negatives with a leading minus", () => {
    expect(formatGhs("-200")).toBe("-GH₵ 200.00");
    expect(formatGhs("-1234.5")).toBe("-GH₵ 1,234.50");
  });
});

describe("isValidAmountInput", () => {
  it.each(["1", "1.5", "1.50", "0.01", "150", "999999999999.99"])("accepts %s", (value) => {
    expect(isValidAmountInput(value)).toBe(true);
  });

  it.each(["", "abc", "1.234", "-5", "1e3", "1.", ".5", "1,000", "1000000000000", " 1"])(
    "rejects %j",
    (value) => {
      expect(isValidAmountInput(value)).toBe(false);
    },
  );
});

describe("normalizeAmount", () => {
  it("pads to two decimals", () => {
    expect(normalizeAmount("150")).toBe("150.00");
    expect(normalizeAmount("150.5")).toBe("150.50");
    expect(normalizeAmount("0.07")).toBe("0.07");
  });
});
