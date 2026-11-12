/**
 * Monthly summaries: the figures the dashboard and insights are built from.
 * Pure functions over recorded transactions; nothing here estimates or invents.
 *
 * Definitions (shown to the user wherever these figures appear):
 *   net            = income - expenses
 *   savings rate   = net / income            (undefined when income is zero)
 *   fixed expense  = an expense flagged fixed (recurring commitments such as
 *                    rent, bills, subscriptions); everything else is variable
 */

import { monthOf, type IsoDate, type YearMonth } from "./dates";
import { ZERO, add, changeBps, mulRatio, ratioBps, sub, sum, type Centimes } from "./money";

export type TransactionKind = "income" | "expense";

export interface Transaction {
  id: string;
  date: IsoDate;
  kind: TransactionKind;
  /** Always positive; `kind` gives the direction. */
  amount: Centimes;
  categoryId: string;
  /** Fixed commitment (true) or variable spending (false). Ignored for income. */
  isFixed: boolean;
}

export interface CategoryTotal {
  categoryId: string;
  total: Centimes;
  /** Share of the month's expenses in basis points. */
  shareBps: number;
}

export interface MonthlySummary {
  month: YearMonth;
  income: Centimes;
  expenses: Centimes;
  fixedExpenses: Centimes;
  variableExpenses: Centimes;
  net: Centimes;
  /** Basis points; null when there is no income to measure against. */
  savingsRateBps: number | null;
  /** Expense categories, largest first. */
  expensesByCategory: CategoryTotal[];
  transactionCount: number;
}

function assertValid(tx: Transaction): void {
  if (tx.amount <= 0) {
    throw new RangeError(`Transaction ${tx.id} must have a positive amount`);
  }
}

export function summarizeMonth(transactions: readonly Transaction[], month: YearMonth): MonthlySummary {
  let income = ZERO;
  let fixedExpenses = ZERO;
  let variableExpenses = ZERO;
  let transactionCount = 0;
  const byCategory = new Map<string, Centimes>();

  for (const tx of transactions) {
    if (monthOf(tx.date) !== month) continue;
    assertValid(tx);
    transactionCount++;
    if (tx.kind === "income") {
      income = add(income, tx.amount);
    } else {
      if (tx.isFixed) fixedExpenses = add(fixedExpenses, tx.amount);
      else variableExpenses = add(variableExpenses, tx.amount);
      byCategory.set(tx.categoryId, add(byCategory.get(tx.categoryId) ?? ZERO, tx.amount));
    }
  }

  const expenses = add(fixedExpenses, variableExpenses);
  const net = sub(income, expenses);
  const expensesByCategory = [...byCategory]
    .map(([categoryId, total]) => ({ categoryId, total, shareBps: ratioBps(total, expenses) ?? 0 }))
    .sort((a, b) => b.total - a.total || a.categoryId.localeCompare(b.categoryId));

  return {
    month,
    income,
    expenses,
    fixedExpenses,
    variableExpenses,
    net,
    savingsRateBps: ratioBps(net, income),
    expensesByCategory,
    transactionCount,
  };
}

export interface CategoryChange {
  categoryId: string;
  current: Centimes;
  previous: Centimes;
  delta: Centimes;
  /** Relative change in basis points; null when there was no spending to compare with. */
  changeBps: number | null;
}

/**
 * Expense change per category between two months, largest absolute change
 * first. Backs insights like "18% more on transportation this month".
 */
export function compareCategorySpending(
  transactions: readonly Transaction[],
  month: YearMonth,
  previousMonth: YearMonth,
): CategoryChange[] {
  const current = new Map(
    summarizeMonth(transactions, month).expensesByCategory.map((c) => [c.categoryId, c.total]),
  );
  const previous = new Map(
    summarizeMonth(transactions, previousMonth).expensesByCategory.map((c) => [c.categoryId, c.total]),
  );
  const ids = new Set([...current.keys(), ...previous.keys()]);
  return [...ids]
    .map((categoryId) => {
      const cur = current.get(categoryId) ?? ZERO;
      const prev = previous.get(categoryId) ?? ZERO;
      return { categoryId, current: cur, previous: prev, delta: sub(cur, prev), changeBps: changeBps(cur, prev) };
    })
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.categoryId.localeCompare(b.categoryId));
}

/**
 * Mean monthly expenses across the given months. Months with no recorded
 * spending count as zero, so pass only months the user was actually tracking.
 * Null when no months are given.
 */
export function averageMonthlyExpenses(
  transactions: readonly Transaction[],
  months: readonly YearMonth[],
): Centimes | null {
  if (months.length === 0) return null;
  const total = sum(months.map((month) => summarizeMonth(transactions, month).expenses));
  return mulRatio(total, 1, months.length);
}
