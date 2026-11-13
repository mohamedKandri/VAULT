/**
 * Command Center view model: every figure the dashboard shows, computed from
 * the ledger by the engine. The React components only lay these values out.
 */

import type { Ledger } from "../../data/ledger";
import {
  ZERO,
  addDays,
  addMonths,
  addMonthsToYearMonth,
  compareCategorySpending,
  monthBounds,
  monthOf,
  positionAt,
  sub,
  sum,
  summarizeMonth,
  upcomingOccurrences,
  type Centimes,
  type IsoDate,
  type MonthlySummary,
  type Position,
  type UpcomingOccurrence,
  type YearMonth,
} from "../../engine";

export const HISTORY_MONTHS = 12;
export const UPCOMING_DAYS = 30;

export interface MonthPoint {
  month: YearMonth;
  income: Centimes;
  expenses: Centimes;
  net: Centimes;
  savingsRateBps: number | null;
  /** Position at month end (or today for the current month); null if unknown. */
  position: Position | null;
  /** True for the current month: figures cover the month to date only. */
  partial: boolean;
}

export interface CategoryRow {
  id: string;
  name: string;
  total: Centimes;
  shareBps: number;
  /** Change vs the same days of the previous month; null if nothing to compare. */
  changeBps: number | null;
}

export interface DashboardModel {
  today: IsoDate;
  month: YearMonth;
  hasData: boolean;
  position: Position | null;
  /** Position at the end of the previous month, for deltas. */
  previousPosition: Position | null;
  current: MonthlySummary;
  /** Previous month up to the same day, so a partial month is compared like for like. */
  samePeriodLastMonth: MonthlySummary | null;
  samePeriodEnd: IsoDate;
  months: MonthPoint[];
  categories: CategoryRow[];
  upcoming: UpcomingOccurrence[];
  upcomingExpenseTotal: Centimes;
}

export function buildDashboard(ledger: Ledger, today: IsoDate): DashboardModel {
  const { accounts, transactions, schedules, categories } = ledger;
  const month = monthOf(today);
  const previousMonth = addMonthsToYearMonth(month, -1);
  const samePeriodEnd = addMonths(today, -1);
  const recorded = transactions.filter((tx) => tx.date <= today);

  // Start the history at the first month that has any record, never earlier:
  // months before tracking began are unknown, not zero.
  const firstRecordDates = [
    ...accounts.map((a) => a.openingDate),
    ...recorded.map((tx) => tx.date),
  ].sort();
  const earliest = firstRecordDates.length > 0 ? monthOf(firstRecordDates[0]) : month;
  const windowStart = addMonthsToYearMonth(month, -(HISTORY_MONTHS - 1));
  const firstMonth = earliest > windowStart ? earliest : windowStart;

  const months: MonthPoint[] = [];
  for (let m = firstMonth; m <= month; m = addMonthsToYearMonth(m, 1)) {
    const summary = summarizeMonth(recorded, m);
    const partial = m === month;
    months.push({
      month: m,
      income: summary.income,
      expenses: summary.expenses,
      net: summary.net,
      savingsRateBps: summary.savingsRateBps,
      position: positionAt(accounts, recorded, partial ? today : monthBounds(m).end),
      partial,
    });
  }

  const current = summarizeMonth(recorded, month);
  const likeForLike = recorded.filter(
    (tx) => monthOf(tx.date) !== previousMonth || tx.date <= samePeriodEnd,
  );
  const previous = summarizeMonth(likeForLike, previousMonth);
  const samePeriodLastMonth = previous.transactionCount > 0 ? previous : null;

  const names = new Map(categories.map((c) => [c.id, c.name]));
  const changes = new Map(
    compareCategorySpending(likeForLike, month, previousMonth).map((c) => [c.categoryId, c.changeBps]),
  );
  const categoryRows: CategoryRow[] = current.expensesByCategory.map((c) => ({
    id: c.categoryId,
    name: names.get(c.categoryId) ?? "Uncategorized",
    total: c.total,
    shareBps: c.shareBps,
    changeBps: samePeriodLastMonth ? (changes.get(c.categoryId) ?? null) : null,
  }));

  const upcoming = upcomingOccurrences(schedules, addDays(today, 1), addDays(today, UPCOMING_DAYS));
  const upcomingExpenseTotal = sum(upcoming.filter((u) => u.kind === "expense").map((u) => u.amount));

  return {
    today,
    month,
    hasData: accounts.length > 0 || transactions.length > 0,
    position: positionAt(accounts, recorded, today),
    previousPosition: positionAt(accounts, recorded, monthBounds(previousMonth).end),
    current,
    samePeriodLastMonth,
    samePeriodEnd,
    months,
    categories: categoryRows,
    upcoming,
    upcomingExpenseTotal,
  };
}

/** Change between two optional amounts; null when either side is unknown. */
export function delta(current: Centimes | null | undefined, previous: Centimes | null | undefined): Centimes | null {
  if (current == null || previous == null) return null;
  return sub(current, previous);
}

export { ZERO };
