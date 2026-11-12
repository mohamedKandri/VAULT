/**
 * Recurring transactions.
 *
 * A rule is stored once and expanded on demand; occurrences are computed
 * from the rule's start date every time, never by stepping from the previous
 * occurrence, so month-end schedules cannot drift (Jan 31 -> Feb 28 -> Mar 31).
 *
 * Common schedules map onto three frequencies:
 *   biweekly = weekly, interval 2      quarterly = monthly, interval 3
 */

import {
  addDays,
  addMonths,
  daysBetween,
  monthOf,
  monthsBetween,
  parseIsoDate,
  type IsoDate,
} from "./dates";

export type Frequency = "weekly" | "monthly" | "yearly";

export interface RecurrenceRule {
  frequency: Frequency;
  /** Every N weeks/months/years. Integer >= 1. */
  interval: number;
  /** First occurrence; also fixes the weekday or day-of-month. */
  startDate: IsoDate;
  /** Last day an occurrence may fall on, inclusive. Null/undefined = open-ended. */
  endDate?: IsoDate | null;
}

export class RecurrenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecurrenceError";
  }
}

export function validateRule(rule: RecurrenceRule): void {
  if (!Number.isInteger(rule.interval) || rule.interval < 1) {
    throw new RecurrenceError(`Interval must be an integer >= 1: ${rule.interval}`);
  }
  parseIsoDate(rule.startDate);
  if (rule.endDate != null) {
    parseIsoDate(rule.endDate);
    if (rule.endDate < rule.startDate) {
      throw new RecurrenceError("End date is before start date");
    }
  }
}

/** The k-th occurrence (k = 0 is the start date). */
function occurrenceAt(rule: RecurrenceRule, k: number): IsoDate {
  if (rule.frequency === "weekly") return addDays(rule.startDate, 7 * rule.interval * k);
  const months = (rule.frequency === "yearly" ? 12 : 1) * rule.interval * k;
  return addMonths(rule.startDate, months, parseIsoDate(rule.startDate).day);
}

/** Index of the first occurrence that could fall on or after `from`. */
function firstIndexFrom(rule: RecurrenceRule, from: IsoDate): number {
  if (from <= rule.startDate) return 0;
  if (rule.frequency === "weekly") {
    return Math.ceil(daysBetween(rule.startDate, from) / (7 * rule.interval));
  }
  const stepMonths = (rule.frequency === "yearly" ? 12 : 1) * rule.interval;
  const k = Math.floor(monthsBetween(monthOf(rule.startDate), monthOf(from)) / stepMonths);
  return occurrenceAt(rule, k) >= from ? k : k + 1;
}

/** All occurrence dates within [from, to], inclusive, in ascending order. */
export function occurrencesBetween(rule: RecurrenceRule, from: IsoDate, to: IsoDate): IsoDate[] {
  validateRule(rule);
  parseIsoDate(from);
  parseIsoDate(to);
  const last = rule.endDate != null && rule.endDate < to ? rule.endDate : to;
  const dates: IsoDate[] = [];
  for (let k = firstIndexFrom(rule, from); ; k++) {
    const date = occurrenceAt(rule, k);
    if (date > last) break;
    dates.push(date);
  }
  return dates;
}

/** The first occurrence on or after `from`, or null if the rule has ended. */
export function nextOccurrence(rule: RecurrenceRule, from: IsoDate): IsoDate | null {
  validateRule(rule);
  parseIsoDate(from);
  const date = occurrenceAt(rule, firstIndexFrom(rule, from));
  return rule.endDate != null && date > rule.endDate ? null : date;
}
