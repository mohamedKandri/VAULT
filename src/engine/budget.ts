/**
 * Safe-to-spend and financial health.
 *
 * Every figure comes with the lines that produced it, so the interface can
 * show the calculation rather than ask to be trusted.
 *
 *   spending limit = expected income
 *                    - fixed expenses (recorded + still scheduled this month)
 *                    - savings (net transfers into savings, recorded + scheduled)
 *   remaining      = spending limit - variable spending so far
 *
 * "Expected income" is what has been recorded this month plus what is still
 * scheduled before month end. Nothing is assumed beyond records and schedules.
 */

import type { Account } from "./balances";
import { positionAt } from "./balances";
import { addDays, addMonthsToYearMonth, daysBetween, monthBounds, monthOf, type IsoDate, type YearMonth } from "./dates";
import { ZERO, add, mulRatio, negate, ratioBps, sub, sum, type Centimes } from "./money";
import { upcomingOccurrences, type Schedule } from "./schedule";
import { summarizeMonth, type Transaction } from "./summary";

export interface BudgetLine {
  label: string;
  /** Signed: positive adds to the limit, negative reduces it. */
  amount: Centimes;
}

export interface Budget {
  month: YearMonth;
  expectedIncome: Centimes;
  committed: Centimes;
  savings: Centimes;
  /** What can go to variable spending this month. May be negative. */
  spendingLimit: Centimes;
  variableSpent: Centimes;
  /** Limit minus variable spending so far. Negative = overspent. */
  remaining: Centimes;
  /** Days left in the month, today included. */
  daysLeft: number;
  /** Remaining spread over the days left; null when nothing remains. */
  perDay: Centimes | null;
  /** The calculation, line by line; sums to `remaining`. */
  lines: BudgetLine[];
}

export function safeToSpend(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  schedules: readonly Schedule[],
  today: IsoDate,
): Budget {
  const month = monthOf(today);
  const monthEnd = monthBounds(month).end;
  const recorded = transactions.filter((tx) => tx.date <= today);
  const summary = summarizeMonth(recorded, month);
  const upcoming = today < monthEnd ? upcomingOccurrences(schedules, addDays(today, 1), monthEnd) : [];
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const savingsIds = new Set(accounts.filter((a) => a.kind === "savings").map((a) => a.id));

  const scheduledIncome = sum(upcoming.filter((u) => u.kind === "income").map((u) => u.amount));
  const scheduledExpenses = sum(upcoming.filter((u) => u.kind === "expense").map((u) => u.amount));

  // Net movement into savings accounts: transfers in minus transfers out.
  const intoSavings = (from: string, to: string | null | undefined, amount: Centimes): Centimes => {
    const inbound = to != null && savingsIds.has(to) && !savingsIds.has(from);
    const outbound = savingsIds.has(from) && !(to != null && savingsIds.has(to));
    return inbound ? amount : outbound ? negate(amount) : ZERO;
  };
  const savedSoFar = sum(
    recorded
      .filter((tx) => tx.kind === "transfer" && monthOf(tx.date) === month)
      .map((tx) => intoSavings(tx.accountId, tx.transferAccountId, tx.amount)),
  );
  const savingsScheduled = sum(
    upcoming
      .filter((u) => u.kind === "transfer")
      .map((u) => {
        const s = scheduleById.get(u.scheduleId)!;
        return intoSavings(s.accountId, s.transferAccountId, u.amount);
      }),
  );

  const expectedIncome = add(summary.income, scheduledIncome);
  const committed = add(summary.fixedExpenses, scheduledExpenses);
  const savings = add(savedSoFar, savingsScheduled);
  const spendingLimit = sub(sub(expectedIncome, committed), savings);
  const remaining = sub(spendingLimit, summary.variableExpenses);
  const daysLeft = daysBetween(today, monthEnd) + 1;

  const lines: BudgetLine[] = [
    { label: "Income recorded this month", amount: summary.income },
    { label: "Income still scheduled", amount: scheduledIncome },
    { label: "Fixed expenses recorded", amount: negate(summary.fixedExpenses) },
    { label: "Expenses still scheduled", amount: negate(scheduledExpenses) },
    { label: "Moved to savings", amount: negate(savedSoFar) },
    { label: "Savings transfers still scheduled", amount: negate(savingsScheduled) },
    { label: "Variable spending so far", amount: negate(summary.variableExpenses) },
  ];

  return {
    month,
    expectedIncome,
    committed,
    savings,
    spendingLimit,
    variableSpent: summary.variableExpenses,
    remaining,
    daysLeft,
    perDay: remaining > 0 ? mulRatio(remaining, 1, daysLeft) : null,
    lines,
  };
}

export interface Health {
  /** Full months of history the averages use (0-3). */
  monthsUsed: number;
  averageIncome: Centimes | null;
  averageExpenses: Centimes | null;
  /** Average non-fixed spending per month. */
  averageVariable: Centimes | null;
  /** Net worth divided by average monthly expenses, in tenths of a month (35 = 3.5 months). */
  coverTenths: number | null;
  /** Average fixed expenses as a share of average income, basis points. */
  fixedShareBps: number | null;
  /** Average (income - expenses) / income, basis points. */
  savingsRateBps: number | null;
}

/**
 * Health indicators from up to the last three *complete* months. The current,
 * partial month is excluded so a month in progress cannot distort the averages.
 * With no complete month of records, everything is null.
 */
export function financialHealth(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  today: IsoDate,
): Health {
  const current = monthOf(today);
  // Tracking starts when the first account was opened; without accounts, at the first record.
  const dates = (accounts.length > 0 ? accounts.map((a) => a.openingDate) : transactions.map((t) => t.date)).sort();
  const months: YearMonth[] = [];
  for (let i = 1; i <= 3; i++) {
    const m = addMonthsToYearMonth(current, -i);
    // A month counts only if tracking had started by its first day.
    if (dates.length > 0 && dates[0] <= monthBounds(m).start) months.push(m);
  }
  if (months.length === 0) {
    return { monthsUsed: 0, averageIncome: null, averageExpenses: null, averageVariable: null, coverTenths: null, fixedShareBps: null, savingsRateBps: null };
  }
  const summaries = months.map((m) => summarizeMonth(transactions, m));
  const income = sum(summaries.map((s) => s.income));
  const expenses = sum(summaries.map((s) => s.expenses));
  const fixed = sum(summaries.map((s) => s.fixedExpenses));
  const averageExpenses = mulRatio(expenses, 1, months.length);
  const netWorth = positionAt(accounts, transactions.filter((t) => t.date <= today), today)?.netWorth ?? null;
  const cover = netWorth !== null && averageExpenses > 0 ? ratioBps(netWorth, averageExpenses) : null;

  return {
    monthsUsed: months.length,
    averageIncome: mulRatio(income, 1, months.length),
    averageExpenses,
    averageVariable: mulRatio(sub(expenses, fixed), 1, months.length),
    coverTenths: cover === null ? null : Math.round(cover / 1000),
    fixedShareBps: ratioBps(fixed, income),
    savingsRateBps: ratioBps(sub(income, expenses), income),
  };
}
