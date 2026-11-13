// Display formatting for dates and chart axes. Money formatting lives in the
// engine (formatMAD); nothing here does arithmetic on amounts beyond scaling
// an axis label.

import { parseIsoDate, parseYearMonth, type Centimes, type IsoDate, type YearMonth } from "../engine";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export const monthShort = (month: YearMonth) => MONTHS[parseYearMonth(month).month - 1].slice(0, 3);

export function monthLong(month: YearMonth): string {
  const { year, month: m } = parseYearMonth(month);
  return `${MONTHS[m - 1]} ${year}`;
}

/** "15 Nov" */
export function dayMonth(date: IsoDate): string {
  const { month, day } = parseIsoDate(date);
  return `${day} ${MONTHS[month - 1].slice(0, 3)}`;
}

/** "12 November 2026" */
export function fullDate(date: IsoDate): string {
  const { year, month, day } = parseIsoDate(date);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/** Axis tick label for an amount: 0, 500, 10K, 1.5M. Approximate by design (axis only). */
export function axisAmount(amount: Centimes): string {
  const dirhams = amount / 100;
  const abs = Math.abs(dirhams);
  const trim = (n: number) => String(Math.round(n * 10) / 10);
  if (abs >= 1_000_000) return `${trim(dirhams / 1_000_000)}M`;
  if (abs >= 10_000) return `${trim(dirhams / 1000)}K`;
  return Math.round(dirhams).toLocaleString("en-US");
}

/** "September 2027" */
export function monthYear(date: IsoDate): string {
  const { year, month } = parseIsoDate(date);
  return `${MONTHS[month - 1]} ${year}`;
}
