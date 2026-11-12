/**
 * Calendar-date primitives.
 *
 * Financial records are tied to calendar days, not instants: a salary dated
 * 2026-11-30 is on the 30th regardless of timezone or DST. Dates are therefore
 * plain "YYYY-MM-DD" strings (and months "YYYY-MM"), which sort correctly as
 * text and round-trip through SQLite unchanged. JavaScript `Date` is used only
 * internally, in UTC, for day arithmetic.
 */

/** Calendar date, "YYYY-MM-DD". */
export type IsoDate = string;
/** Calendar month, "YYYY-MM". */
export type YearMonth = string;

export class DateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DateError";
  }
}

export interface DateParts {
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

const pad = (value: number, width: number) => String(value).padStart(width, "0");

export function toIsoDate({ year, month, day }: DateParts): IsoDate {
  if (
    !Number.isInteger(year) || year < 1 || year > 9999 ||
    !Number.isInteger(month) || month < 1 || month > 12 ||
    !Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)
  ) {
    throw new DateError(`Invalid date: ${year}-${month}-${day}`);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

/** Parse and validate "YYYY-MM-DD". Rejects impossible dates like 2026-02-30. */
export function parseIsoDate(date: IsoDate): DateParts {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) throw new DateError(`Not an ISO date (YYYY-MM-DD): "${date}"`);
  const parts = { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
  toIsoDate(parts);
  return parts;
}

export function parseYearMonth(month: YearMonth): { year: number; month: number } {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  const parts = match ? { year: Number(match[1]), month: Number(match[2]) } : null;
  if (!parts || parts.year < 1 || parts.month < 1 || parts.month > 12) {
    throw new DateError(`Not a month (YYYY-MM): "${month}"`);
  }
  return parts;
}

export function toYearMonth(year: number, month: number): YearMonth {
  return toIsoDate({ year, month, day: 1 }).slice(0, 7);
}

export function monthOf(date: IsoDate): YearMonth {
  parseIsoDate(date);
  return date.slice(0, 7);
}

/** First and last day of a month, inclusive. */
export function monthBounds(month: YearMonth): { start: IsoDate; end: IsoDate } {
  const { year, month: m } = parseYearMonth(month);
  return {
    start: toIsoDate({ year, month: m, day: 1 }),
    end: toIsoDate({ year, month: m, day: daysInMonth(year, m) }),
  };
}

const monthIndex = (year: number, month: number) => year * 12 + (month - 1);

export function addMonthsToYearMonth(month: YearMonth, count: number): YearMonth {
  const parts = parseYearMonth(month);
  const index = monthIndex(parts.year, parts.month) + count;
  return toYearMonth(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1);
}

/** Whole months from `from` to `to` (negative when `to` is earlier). */
export function monthsBetween(from: YearMonth, to: YearMonth): number {
  const a = parseYearMonth(from);
  const b = parseYearMonth(to);
  return monthIndex(b.year, b.month) - monthIndex(a.year, a.month);
}

/**
 * Add calendar months, clamping to the end of shorter months.
 * `anchorDay` is the day-of-month to aim for; pass the original day when
 * stepping repeatedly so a Jan 31 schedule gives Feb 28, Mar 31 (not Mar 28).
 */
export function addMonths(date: IsoDate, count: number, anchorDay?: number): IsoDate {
  const parts = parseIsoDate(date);
  const target = addMonthsToYearMonth(toYearMonth(parts.year, parts.month), count);
  const { year, month } = parseYearMonth(target);
  const day = Math.min(anchorDay ?? parts.day, daysInMonth(year, month));
  return toIsoDate({ year, month, day });
}

const MS_PER_DAY = 86_400_000;

function toEpochDay(date: IsoDate): number {
  const { year, month, day } = parseIsoDate(date);
  const utc = new Date(0);
  utc.setUTCFullYear(year, month - 1, day); // setUTCFullYear handles years < 100 correctly
  return Math.round(utc.getTime() / MS_PER_DAY);
}

export function addDays(date: IsoDate, count: number): IsoDate {
  const utc = new Date((toEpochDay(date) + count) * MS_PER_DAY);
  return toIsoDate({
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  });
}

/** Days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: IsoDate, to: IsoDate): number {
  return toEpochDay(to) - toEpochDay(from);
}

/** Today as a local calendar date. The only function here that reads the clock. */
export function today(now: Date = new Date()): IsoDate {
  return toIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}
