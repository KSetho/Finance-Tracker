/**
 * Calendar helpers (mirrors backend/app/core/dates.py). Months are calendar months in Ghana time
 * (Africa/Accra). Dates are ISO "YYYY-MM-DD" strings, which compare correctly as strings.
 */

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

const accraFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Accra',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export class DateValueError extends Error {}

function pad(value: number, width: number): string {
  return String(value).padStart(width, '0');
}

export function makeDate(year: number, month: number, day: number): string {
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function parts(value: string): [number, number, number] {
  return [Number(value.slice(0, 4)), Number(value.slice(5, 7)), Number(value.slice(8, 10))];
}

/** Whether a string is a real calendar date in Python's supported range (year 1..9999). */
export function isIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  return day <= daysInMonth(year, month);
}

const MONTH_DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function daysInMonth(year: number, month: number): number {
  return month === 2 && isLeap(year) ? 29 : MONTH_DAYS[month - 1];
}

function isLeap(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function accraToday(now: Date): string {
  return accraFormatter.format(now);
}

/** '2026-10' -> '2026-10-01'. Throws DateValueError for anything else. */
export function parseMonth(value: string): string {
  const match = MONTH.exec(value);
  if (!match) throw new DateValueError('Month must look like YYYY-MM.');
  const year = Number(match[1]);
  if (year < 1) throw new DateValueError(`year ${year} is out of range`);
  return makeDate(year, Number(match[2]), 1);
}

export function monthOf(value: string): string {
  return `${value.slice(0, 8)}01`;
}

/** Half-open [first day, first day of next month) for the month containing value. */
export function monthRange(value: string): [string, string] {
  const start = monthOf(value);
  return [start, addMonths(start, 1)];
}

export function formatMonth(value: string): string {
  return value.slice(0, 7);
}

/** First day of the month `months` away from the month containing value (negative = earlier). */
export function addMonths(value: string, months: number): string {
  const [year, month] = parts(value);
  const index = year * 12 + (month - 1) + months;
  return makeDate(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1, 1);
}

function toUtc(value: string): number {
  const [year, month, day] = parts(value);
  const date = new Date(Date.UTC(2000, month - 1, day));
  date.setUTCFullYear(year);
  return date.getTime();
}

function fromUtc(ms: number): string {
  const date = new Date(ms);
  return makeDate(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate());
}

const DAY_MS = 86_400_000;

export function addDays(value: string, days: number): string {
  return fromUtc(toUtc(value) + days * DAY_MS);
}

/** (b - a) in whole days, like (b - a).days in Python. */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / DAY_MS);
}

/** Pydantic-style ISO 8601 for aware datetimes (UTC, "Z" suffix). */
export function isoDateTime(value: Date): string {
  return value.toISOString();
}

export function addMinutes(value: Date, minutes: number): Date {
  return new Date(value.getTime() + minutes * 60_000);
}

export function addHours(value: Date, hours: number): Date {
  return new Date(value.getTime() + hours * 3_600_000);
}
