/** Exact money: Decimal in code, a two-decimal string in JSON (mirrors backend/app/schemas/common.py). */
import DecimalBase from 'decimal.js';

// Python's default decimal context: 28 significant digits, banker's rounding for quantize().
export const Decimal = DecimalBase.clone({ precision: 28, rounding: DecimalBase.ROUND_HALF_EVEN });
export type Decimal = DecimalBase;

export const ZERO = new Decimal('0.00');
const MAX_ABS = new Decimal(10).pow(12); // 12 integer digits, matching NUMERIC(14,2)
const PLAIN_NUMBER = /^-?\d+(\.\d+)?$/;

export function dec(value: DecimalBase.Value | Decimal): Decimal {
  return new Decimal(value);
}

/** Round to two places (banker's rounding, like Decimal.quantize(Decimal("0.00"))). */
export function quantize(value: DecimalBase.Value | Decimal): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_EVEN);
}

export function quantizeHalfUp(value: DecimalBase.Value | Decimal): Decimal {
  return new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
}

/** "12.30" - never "-0.00". */
export function formatMoney(value: DecimalBase.Value | Decimal): string {
  const q = quantize(value);
  return (q.isZero() ? q.abs() : q).toFixed(2);
}

export function formatMoneyOrNull(value: Decimal | null): string | null {
  return value === null ? null : formatMoney(value);
}

export function sum(values: Iterable<Decimal>): Decimal {
  let total = ZERO;
  for (const value of values) total = total.plus(value);
  return total;
}

export class MoneyError extends Error {}

/** Parse a JSON value into money; throws MoneyError like Pydantic's Money validator. */
export function toMoney(value: unknown): Decimal {
  if (value === null || value === undefined || typeof value === 'boolean') {
    throw new MoneyError('Enter an amount.');
  }
  let number: Decimal;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new MoneyError('Enter a valid amount.');
    // String() is the shortest round-trip form (like Python repr), so binary artifacts are rejected.
    number = new Decimal(String(value));
  } else if (typeof value === 'string') {
    if (!PLAIN_NUMBER.test(value)) throw new MoneyError('Enter a valid amount.');
    number = new Decimal(value);
  } else {
    throw new MoneyError('Enter a valid amount.');
  }
  if (!number.isFinite()) throw new MoneyError('Enter a valid amount.');
  if (!number.equals(number.toDecimalPlaces(2))) {
    throw new MoneyError('Amounts can have at most two decimal places.');
  }
  if (number.abs().greaterThanOrEqualTo(MAX_ABS)) throw new MoneyError('That amount is too large.');
  return quantize(number);
}

export function toPositiveMoney(value: unknown): Decimal {
  const number = toMoney(value);
  if (number.lessThanOrEqualTo(0)) throw new MoneyError('Amount must be greater than zero.');
  return number;
}

export function toNonNegativeMoney(value: unknown): Decimal {
  const number = toMoney(value);
  if (number.lessThan(0)) throw new MoneyError('Amount cannot be negative.');
  return number;
}
