/**
 * Scheduled (recurring) transactions and their upcoming occurrences.
 * A schedule is a transaction template plus a recurrence rule.
 */

import type { IsoDate } from "./dates";
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
