/**
 * Balance forecast: where the accounts stand at each coming month end if
 * the recurring items happen as scheduled, variable spending continues at a
 * stated monthly figure, and the planned purchases are made.
 *
 * Inputs are the current position (from records), the schedules, and two
 * explicit assumptions the caller supplies and the interface displays:
 * monthly variable spending and any planned purchases. Nothing else.
 */

import type { Account } from "./balances";
import { positionAt } from "./balances";
import { addDays, addMonthsToYearMonth, daysBetween, monthBounds, monthOf, type IsoDate, type YearMonth } from "./dates";
import { ZERO, add, mulRatio, sub, type Centimes } from "./money";
import { upcomingOccurrences, type Schedule } from "./schedule";
import type { Transaction } from "./summary";

export interface PlannedPurchase {
  name: string;
  date: IsoDate;
  /** Everything due on purchase day (price plus one-off costs). */
  amount: Centimes;
  /** Recurring ownership cost that starts the month after the purchase. */
  monthlyOwnership?: Centimes;
}

export interface ForecastInput {
  accounts: readonly Account[];
  transactions: readonly Transaction[];
  schedules: readonly Schedule[];
  today: IsoDate;
  /** Number of month ends to project, the current month included. */
  months: number;
  /** Assumed variable spending per month. Prorated for the rest of the current month. */
  monthlyVariable: Centimes;
  purchases?: readonly PlannedPurchase[];
}

export interface ForecastMonth {
  month: YearMonth;
  /** Scheduled income in the period. */
  income: Centimes;
  /** Scheduled expenses + assumed variable spending + ownership costs. */
  expenses: Centimes;
  /** Paid for planned purchases in the period. */
  purchases: Centimes;
  available: Centimes;
  savings: Centimes;
  netWorth: Centimes;
  warnings: string[];
}

export interface Forecast {
  /** Null when the current position is unknown (no accounts yet). */
  start: { available: Centimes; savings: Centimes; netWorth: Centimes } | null;
  months: ForecastMonth[];
  /** First month in which a warning appears, if any. */
  firstWarning: YearMonth | null;
}

export function forecastBalances(input: ForecastInput): Forecast {
  const { accounts, schedules, today } = input;
  if (!Number.isInteger(input.months) || input.months < 1 || input.months > 120) {
    throw new RangeError(`Months must be an integer between 1 and 120: ${input.months}`);
  }
  const position = positionAt(accounts, input.transactions.filter((t) => t.date <= today), today);
  if (!position) return { start: null, months: [], firstWarning: null };

  const isSavings = new Map(accounts.map((a) => [a.id, a.kind === "savings"]));
  const scheduleById = new Map(schedules.map((s) => [s.id, s]));
  const purchases = [...(input.purchases ?? [])].sort((a, b) => a.date.localeCompare(b.date));

  let available = position.available;
  let savings = position.savings;
  let ownership = ZERO; // monthly ownership cost of purchases already made
  const months: ForecastMonth[] = [];
  const currentMonth = monthOf(today);

  for (let i = 0; i < input.months; i++) {
    const month = addMonthsToYearMonth(currentMonth, i);
    const bounds = monthBounds(month);
    const from = i === 0 ? addDays(today, 1) : bounds.start;
    const warnings: string[] = [];
    let income = ZERO;
    let expenses = ZERO;
    let purchased = ZERO;
    const move = (accountId: string, amount: Centimes) => {
      if (isSavings.get(accountId)) savings = add(savings, amount);
      else available = add(available, amount);
    };

    if (from <= bounds.end) {
      for (const occurrence of upcomingOccurrences(schedules, from, bounds.end)) {
        const schedule = scheduleById.get(occurrence.scheduleId)!;
        if (occurrence.kind === "income") {
          income = add(income, occurrence.amount);
          move(schedule.accountId, occurrence.amount);
        } else if (occurrence.kind === "expense") {
          expenses = add(expenses, occurrence.amount);
          move(schedule.accountId, sub(ZERO, occurrence.amount));
        } else if (schedule.transferAccountId) {
          move(schedule.accountId, sub(ZERO, occurrence.amount));
          move(schedule.transferAccountId, occurrence.amount);
        }
      }

      // Assumed variable spending: the remaining share of the current month, then full months.
      const daysInMonth = daysBetween(bounds.start, bounds.end) + 1;
      const daysCounted = daysBetween(from, bounds.end) + 1;
      const variable = add(mulRatio(input.monthlyVariable, daysCounted, daysInMonth), ownership);
      expenses = add(expenses, variable);
      available = sub(available, variable);

      for (const purchase of purchases) {
        if (purchase.date < from || purchase.date > bounds.end) continue;
        purchased = add(purchased, purchase.amount);
        // Paid from savings first, then from available money.
        const fromSavings = savings >= purchase.amount ? purchase.amount : savings > 0 ? savings : ZERO;
        savings = sub(savings, fromSavings);
        available = sub(available, sub(purchase.amount, fromSavings));
        if (available < 0) warnings.push(`${purchase.name} costs more than the funds projected for that date.`);
        ownership = add(ownership, purchase.monthlyOwnership ?? ZERO);
      }
    }

    if (available < 0 && warnings.length === 0) {
      warnings.push("Projected expenses exceed available funds.");
    }
    months.push({ month, income, expenses, purchases: purchased, available, savings, netWorth: add(available, savings), warnings });
  }

  return {
    start: { available: position.available, savings: position.savings, netWorth: position.netWorth },
    months,
    firstWarning: months.find((m) => m.warnings.length > 0)?.month ?? null,
  };
}
