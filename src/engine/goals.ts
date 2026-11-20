/**
 * Purchase goals (a motorcycle, a car...) and what they really cost.
 *
 * The purchase price is never treated as the whole cost: registration and
 * other one-off costs are added to what must be saved, and recurring
 * ownership costs (insurance, fuel, maintenance) are reported as a monthly
 * burden that starts the day the purchase is made.
 */

import { addMonths, monthOf, monthsBetween, type IsoDate } from "./dates";
import { ZERO, add, divideUp, mulRatio, ratioBps, sub, sum, times, unitsToCover, type Centimes } from "./money";

export type CostFrequency = "once" | "monthly" | "yearly";

export interface OwnershipCost {
  label: string;
  amount: Centimes;
  frequency: CostFrequency;
}

export interface Goal {
  id: string;
  name: string;
  targetPrice: Centimes;
  /** Already set aside for this goal. */
  savedAmount: Centimes;
  /** Desired purchase date; null = no deadline. */
  targetDate: IsoDate | null;
  monthlyContribution: Centimes;
  /** 1 = highest. */
  priority: number;
  status: "active" | "achieved" | "archived";
  costs: OwnershipCost[];
}

export interface GoalPlan {
  goalId: string;
  /** Price plus one-off costs: what has to be available on purchase day. */
  upfrontTotal: Centimes;
  oneOffCosts: Centimes;
  remaining: Centimes;
  /** Saved as a share of the upfront total, basis points (capped at 10000). */
  progressBps: number;
  /** Months to reach the total at the current contribution; null if it never does. */
  monthsAtContribution: number | null;
  estimatedDate: IsoDate | null;
  /** Whole months until the target date (at least 1); null without a date. */
  monthsUntilTarget: number | null;
  /** Monthly saving needed to be ready by the target date; null without a date. */
  requiredMonthly: Centimes | null;
  /** True/false with a target date; null without one. */
  onTrack: boolean | null;
  /** Recurring cost of owning it, per month (yearly costs spread over 12). */
  monthlyOwnership: Centimes;
  /** Upfront total plus twelve months of ownership. */
  firstYearCost: Centimes;
  /** Contribution as a share of the monthly surplus; null if no surplus is known or it is not positive. */
  contributionShareBps: number | null;
  /** Ownership cost as a share of the monthly surplus, once bought. */
  ownershipShareBps: number | null;
  /** Surplus left each month after buying, once contributions stop and ownership costs start. */
  surplusAfterPurchase: Centimes | null;
}

/**
 * @param monthlySurplus average income minus expenses, if known. Used only
 *   for the affordability shares; pass null when there is not enough history.
 */
export function planGoal(goal: Goal, today: IsoDate, monthlySurplus: Centimes | null): GoalPlan {
  const oneOffCosts = sum(goal.costs.filter((c) => c.frequency === "once").map((c) => c.amount));
  const monthly = sum(goal.costs.filter((c) => c.frequency === "monthly").map((c) => c.amount));
  const yearly = sum(goal.costs.filter((c) => c.frequency === "yearly").map((c) => c.amount));
  const monthlyOwnership = add(monthly, mulRatio(yearly, 1, 12));

  const upfrontTotal = add(goal.targetPrice, oneOffCosts);
  const gap = sub(upfrontTotal, goal.savedAmount);
  const remaining = gap > 0 ? gap : ZERO;
  const progressBps = Math.min(10_000, Math.max(0, ratioBps(goal.savedAmount, upfrontTotal) ?? 10_000));

  const monthsAtContribution = unitsToCover(remaining, goal.monthlyContribution);
  const estimatedDate = monthsAtContribution === null ? null : addMonths(today, monthsAtContribution);

  let monthsUntilTarget: number | null = null;
  let requiredMonthly: Centimes | null = null;
  let onTrack: boolean | null = null;
  if (goal.targetDate) {
    monthsUntilTarget = Math.max(1, monthsBetween(monthOf(today), monthOf(goal.targetDate)));
    requiredMonthly = remaining === 0 ? ZERO : divideUp(remaining, monthsUntilTarget);
    onTrack = remaining === 0 || (monthsAtContribution !== null && monthsAtContribution <= monthsUntilTarget);
  }

  const hasSurplus = monthlySurplus !== null && monthlySurplus > 0;
  return {
    goalId: goal.id,
    upfrontTotal,
    oneOffCosts,
    remaining,
    progressBps,
    monthsAtContribution,
    estimatedDate,
    monthsUntilTarget,
    requiredMonthly,
    onTrack,
    monthlyOwnership,
    firstYearCost: add(upfrontTotal, times(monthlyOwnership, 12)),
    contributionShareBps: hasSurplus ? ratioBps(goal.monthlyContribution, monthlySurplus) : null,
    ownershipShareBps: hasSurplus ? ratioBps(monthlyOwnership, monthlySurplus) : null,
    surplusAfterPurchase: monthlySurplus === null ? null : sub(monthlySurplus, monthlyOwnership),
  };
}

/** Typical ownership cost lines offered when creating a vehicle goal. Amounts are entered by the user. */
export const VEHICLE_COST_LABELS: { label: string; frequency: CostFrequency }[] = [
  { label: "Registration", frequency: "once" },
  { label: "Insurance", frequency: "yearly" },
  { label: "Fuel", frequency: "monthly" },
  { label: "Maintenance", frequency: "yearly" },
];
