/**
 * Scheduled (recurring) transactions and their upcoming occurrences.
 * A schedule is a transaction template plus a recurrence rule.
 */

import { addDays, type IsoDate } from "./dates";
import type { Centimes } from "./money";
import { occurrencesBetween, type RecurrenceRule } from "./recurrence";
import type { TransactionKind } from "./summary";

export interface Schedule {
  id: string;
  rule: RecurrenceRule;
  accountId: string;
  kind: TransactionKind;
  amount: Centimes;
  categoryId: string | null;
  transferAccountId?: string | null;
  description: string;
  isFixed: boolean;
  paused?: boolean;
  /** Occurrences up to and including this date have already been recorded. */
  postedThrough?: IsoDate | null;
}

export interface DueOccurrence {
  scheduleId: string;
  date: IsoDate;
}

/**
 * Occurrences that should now be recorded as real transactions: those after
 * each schedule's `postedThrough` (or from its start) up to `today`.
 */
export function dueOccurrences(schedules: readonly Schedule[], today: IsoDate): DueOccurrence[] {
  const due: DueOccurrence[] = [];
  for (const schedule of schedules) {
    if (schedule.paused) continue;
    const from = schedule.postedThrough ? addDays(schedule.postedThrough, 1) : schedule.rule.startDate;
    if (from > today) continue;
    for (const date of occurrencesBetween(schedule.rule, from, today)) {
      due.push({ scheduleId: schedule.id, date });
    }
  }
  return due;
}

/** "Monthly", "Every 2 weeks", "Quarterly"... */
export function describeFrequency(rule: RecurrenceRule): string {
  const { frequency, interval } = rule;
  if (frequency === "weekly") return interval === 1 ? "Weekly" : `Every ${interval} weeks`;
  if (frequency === "yearly") return interval === 1 ? "Yearly" : `Every ${interval} years`;
  if (interval === 1) return "Monthly";
  if (interval === 3) return "Quarterly";
  return `Every ${interval} months`;
}

export interface UpcomingOccurrence {
  scheduleId: string;
  date: IsoDate;
  kind: TransactionKind;
  amount: Centimes;
  categoryId: string | null;
  description: string;
}

/** Occurrences of active schedules within [from, to], soonest first. */
export function upcomingOccurrences(
  schedules: readonly Schedule[],
  from: IsoDate,
  to: IsoDate,
): UpcomingOccurrence[] {
  const upcoming: UpcomingOccurrence[] = [];
  for (const schedule of schedules) {
    if (schedule.paused) continue;
    for (const date of occurrencesBetween(schedule.rule, from, to)) {
      upcoming.push({
        scheduleId: schedule.id,
        date,
        kind: schedule.kind,
        amount: schedule.amount,
        categoryId: schedule.categoryId,
        description: schedule.description,
      });
    }
  }
  return upcoming.sort(
    (a, b) => a.date.localeCompare(b.date) || b.amount - a.amount || a.scheduleId.localeCompare(b.scheduleId),
  );
}
