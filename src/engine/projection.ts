/**
 * Savings projection: plain arithmetic on stated assumptions.
 *
 *   surplus      = income + additional income - expenses        (per month)
 *   contribution = the chosen monthly contribution, or the whole surplus
 *   savings[n]   = savings[n-1] + contribution
 *
 * If the surplus cannot cover the chosen contribution, only the surplus is
 * saved (a negative surplus draws savings down) and the month is flagged.
 * No interest, inflation or investment return is modelled: this is a ruler,
 * not a forecast of markets.
 */

import { addMonthsToYearMonth, type YearMonth } from "./dates";
import { ZERO, add, applyBps, sub, unitsToCover, type Centimes } from "./money";

export interface ProjectionInput {
  startingSavings: Centimes;
  monthlyIncome: Centimes;
  additionalIncome: Centimes;
  monthlyExpenses: Centimes;
  /** Null = save the whole surplus. */
  monthlyContribution: Centimes | null;
  /** Null = no target. */
  target: Centimes | null;
}

/** A scenario is a named, visible adjustment of the inputs. Nothing hidden. */
export interface Scenario {
  id: string;
  label: string;
  /** Change applied to monthly income, in basis points (+500 = +5%). */
  incomeBps: number;
  /** Change applied to monthly expenses, in basis points. */
  expensesBps: number;
  /** Share of the additional (irregular) income that is counted, 0-10000. */
  additionalIncomeShareBps: number;
}

export const DEFAULT_SCENARIOS: Scenario[] = [
  { id: "conservative", label: "Conservative", incomeBps: 0, expensesBps: 1000, additionalIncomeShareBps: 0 },
  { id: "normal", label: "Normal", incomeBps: 0, expensesBps: 0, additionalIncomeShareBps: 10_000 },
  { id: "aggressive", label: "Aggressive", incomeBps: 0, expensesBps: -1000, additionalIncomeShareBps: 10_000 },
];

export interface ProjectionPoint {
  /** 0 = now, 1 = after one month... */
  index: number;
  month: YearMonth;
  savings: Centimes;
}

export interface Projection {
  scenario: Scenario;
  income: Centimes;
  additionalIncome: Centimes;
  expenses: Centimes;
  surplus: Centimes;
  /** What actually goes to savings each month. Negative = drawing savings down. */
  contribution: Centimes;
  /** True when the surplus is smaller than the contribution asked for. */
  shortfall: boolean;
  points: ProjectionPoint[];
  /** Months until the target is reached; 0 if already there; null if never, or no target. */
  monthsToTarget: number | null;
  /** Savings after the last projected month. */
  finalSavings: Centimes;
}

const adjust = (amount: Centimes, bps: number) => add(amount, applyBps(amount, bps));

export function projectSavings(
  input: ProjectionInput,
  months: number,
  startMonth: YearMonth,
  scenario: Scenario = DEFAULT_SCENARIOS[1],
): Projection {
  if (!Number.isInteger(months) || months < 0 || months > 600) {
    throw new RangeError(`Months must be an integer between 0 and 600: ${months}`);
  }
  const income = adjust(input.monthlyIncome, scenario.incomeBps);
  const expenses = adjust(input.monthlyExpenses, scenario.expensesBps);
  const additionalIncome = applyBps(input.additionalIncome, scenario.additionalIncomeShareBps);
  const surplus = sub(add(income, additionalIncome), expenses);
  const wanted = input.monthlyContribution;
  const shortfall = wanted !== null && surplus < wanted;
  const contribution = wanted === null || shortfall ? surplus : wanted;

  const points: ProjectionPoint[] = [];
  let savings = input.startingSavings;
  for (let index = 0; index <= months; index++) {
    if (index > 0) savings = add(savings, contribution);
    points.push({ index, month: addMonthsToYearMonth(startMonth, index), savings });
  }

  const monthsToTarget =
    input.target === null ? null : unitsToCover(sub(input.target, input.startingSavings), contribution > 0 ? contribution : ZERO);

  return { scenario, income, additionalIncome, expenses, surplus, contribution, shortfall, points, monthsToTarget, finalSavings: savings };
}

/** The same inputs under each scenario, for side-by-side comparison. */
export function projectScenarios(
  input: ProjectionInput,
  months: number,
  startMonth: YearMonth,
  scenarios: readonly Scenario[] = DEFAULT_SCENARIOS,
): Projection[] {
  return scenarios.map((scenario) => projectSavings(input, months, startMonth, scenario));
}
