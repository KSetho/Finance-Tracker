/**
 * Small validators reproducing Pydantic's lax-mode rules for the fields this API uses. Every
 * failure is a RequestValidationError (422 "validation_error"), as FastAPI renders them.
 */
import { isIsoDate } from './dates';
import { RequestValidationError } from './errors';
import { type Decimal, toMoney, toNonNegativeMoney, toPositiveMoney } from './money';

export type Raw = Record<string, unknown>;
type Parser<T> = (value: unknown) => T;

export function invalid(): never {
  throw new RequestValidationError();
}

export function has(raw: Raw, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(raw, key);
}

/** Length in code points, as Python's len() counts. */
export function charLength(value: string): number {
  return [...value].length;
}

export function str({ min = 0, max, strip = false }: { min?: number; max?: number; strip?: boolean } = {}): Parser<string> {
  return (value) => {
    if (typeof value !== 'string') invalid();
    const result = strip ? (value as string).trim() : (value as string);
    const length = charLength(result);
    if (length < min || (max !== undefined && length > max)) invalid();
    return result;
  };
}

function guardMoney(parse: (value: unknown) => Decimal): Parser<Decimal> {
  return (value) => {
    try {
      return parse(value);
    } catch {
      return invalid();
    }
  };
}

export const money = guardMoney(toMoney);
export const positiveMoney = guardMoney(toPositiveMoney);
export const nonNegativeMoney = guardMoney(toNonNegativeMoney);

const UUID_HEX = /^[0-9a-fA-F]{32}$/;

/** Accepts hyphenated, simple, braced and urn forms; returns lowercase hyphenated. */
export const uuidValue: Parser<string> = (value) => {
  if (typeof value !== 'string') invalid();
  let text = (value as string).trim();
  if (text.toLowerCase().startsWith('urn:uuid:')) text = text.slice(9);
  if (text.startsWith('{') && text.endsWith('}')) text = text.slice(1, -1);
  const hyphenated = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(text);
  const hex = hyphenated ? text.replace(/-/g, '') : text;
  if (!UUID_HEX.test(hex)) invalid();
  const h = hex.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export const dateValue: Parser<string> = (value) => {
  if (typeof value !== 'string' || !isIsoDate(value)) invalid();
  return value as string;
};

export const intValue: Parser<number> = (value) => {
  if (typeof value === 'number') {
    if (!Number.isInteger(value)) invalid();
    return value;
  }
  if (typeof value === 'string' && /^\s*[+-]?\d+\s*$/.test(value)) {
    return Number.parseInt(value.trim(), 10);
  }
  return invalid();
};

export function enumValue<T extends string>(values: readonly T[]): Parser<T> {
  return (value) => {
    if (typeof value !== 'string' || !(values as readonly string[]).includes(value)) invalid();
    return value as T;
  };
}

/** Required field; null is passed to the parser (which rejects it unless it allows null). */
export function required<T>(raw: Raw, key: string, parse: Parser<T>): T {
  if (!has(raw, key)) invalid();
  return parse(raw[key]);
}

/** `X | None = None`: absent or null -> null. */
export function nullable<T>(raw: Raw, key: string, parse: Parser<T>): T | null {
  if (!has(raw, key) || raw[key] === null) return null;
  return parse(raw[key]);
}

/** `X = default`: absent -> default; present values (null included) must parse. */
export function withDefault<T>(raw: Raw, key: string, parse: Parser<T>, fallback: T): T {
  if (!has(raw, key)) return fallback;
  return parse(raw[key]);
}

// ---- query strings ---------------------------------------------------------------------------

const TRUE_VALUES = new Set(['1', 'on', 't', 'true', 'y', 'yes']);
const FALSE_VALUES = new Set(['0', 'off', 'f', 'false', 'n', 'no']);

export const boolValue: Parser<boolean> = (value) => {
  if (typeof value !== 'string') invalid();
  const lowered = (value as string).trim().toLowerCase();
  if (TRUE_VALUES.has(lowered)) return true;
  if (FALSE_VALUES.has(lowered)) return false;
  return invalid();
};

/** Optional query parameter: absent -> fallback, present -> must parse. */
export function query<T, D>(params: URLSearchParams, key: string, parse: Parser<T>, fallback: D): T | D {
  const value = params.get(key);
  if (value === null) return fallback;
  return parse(value);
}

export function requiredQuery<T>(params: URLSearchParams, key: string, parse: Parser<T>): T {
  const value = params.get(key);
  if (value === null) invalid();
  return parse(value);
}

export function bounded(min: number, max: number): Parser<number> {
  return (value) => {
    const number = intValue(value);
    if (number < min || number > max) invalid();
    return number;
  };
}
