/** Dates are `YYYY-MM-DD` strings; months are `YYYY-MM`. Display is `DD MMM YYYY` in Ghana time. */

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const LONG_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function formatDate(value: string): string {
  const [year, month, day] = value.split("-");
  return `${day} ${SHORT_MONTHS[Number(month) - 1]} ${year}`;
}

/** Today's date in Africa/Accra, whatever time zone the device is set to. */
export function accraToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Accra",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function currentMonth(now: Date = new Date()): string {
  return accraToday(now).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, mon] = month.split("-").map(Number);
  const index = year * 12 + (mon - 1) + delta;
  const newYear = Math.floor(index / 12);
  const newMonth = (index % 12) + 1;
  return `${newYear}-${String(newMonth).padStart(2, "0")}`;
}

export function monthLabel(month: string): string {
  const [year, mon] = month.split("-");
  return `${LONG_MONTHS[Number(mon) - 1]} ${year}`;
}

/** First and last day of a month, for filtering lists by month. */
export function monthBounds(month: string): { start: string; end: string } {
  const next = shiftMonth(month, 1);
  const [ny, nm] = next.split("-").map(Number);
  const last = new Date(Date.UTC(ny, nm - 1, 0)).getUTCDate();
  return { start: `${month}-01`, end: `${month}-${String(last).padStart(2, "0")}` };
}

export function daysInMonth(month: string): number {
  const [year, mon] = month.split("-").map(Number);
  return new Date(Date.UTC(year, mon, 0)).getUTCDate();
}

export function shiftDate(value: string, days: number): string {
  const [year, month, day] = value.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return result.toISOString().slice(0, 10);
}

/** Monday is 0 and Sunday is 6. */
export function mondayIndex(value: string): number {
  const [year, month, day] = value.split("-").map(Number);
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7;
}
