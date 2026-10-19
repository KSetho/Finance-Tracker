/**
 * Money helpers. The browser never does arithmetic on money: it validates typed input, sends a
 * decimal string, and formats the decimal strings the server returns. Nothing here uses Number().
 */

export const MONEY_INPUT_REGEX = /^\d{1,12}(\.\d{1,2})?$/;

export function isValidAmountInput(value: string): boolean {
  return MONEY_INPUT_REGEX.test(value);
}

/** "150" -> "150.00", "150.5" -> "150.50". Only call with a value that passed isValidAmountInput. */
export function normalizeAmount(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  return `${whole}.${(fraction + "00").slice(0, 2)}`;
}

/** Keep only what can be part of an amount while the owner is typing. */
export function sanitizeAmountTyping(raw: string): string {
  let result = "";
  let seenDot = false;
  let decimals = 0;
  let digits = 0;
  for (const char of raw) {
    if (char >= "0" && char <= "9") {
      if (seenDot) {
        if (decimals >= 2) continue;
        decimals += 1;
      } else {
        if (digits >= 12) continue;
        digits += 1;
      }
      result += char;
    } else if (char === "." && !seenDot) {
      seenDot = true;
      result += char;
    }
  }
  return result;
}

/** "-1234.5" -> "-GH₵ 1,234.50". Works on the server's decimal string, digit by digit. */
export function formatGhs(value: string): string {
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}GH₵ ${grouped}.${(fraction + "00").slice(0, 2)}`;
}
