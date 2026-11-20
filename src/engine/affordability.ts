/**
 * Purchase affordability: a rule-based assessment, not a prediction.
 *
 * The verdict comes from explicit thresholds (below), and every reason that
 * contributed to it is returned so the interface can show why. These are
 * guidance categories, not guarantees.
 */

import { ZERO, add, ratioBps, sub, times, unitsToCover, type Centimes } from "./money";

export interface Thresholds {
  /** Below this many months of expenses left in savings: risky. */
  riskyBufferMonths: number;
  /** Below this many: caution. */
  cautionBufferMonths: number;
  /** Taking longer than this to rebuild savings: caution. */
  cautionRecoveryMonths: number;
  /** Installment above this share of the monthly surplus: caution / risky. */
  cautionBurdenBps: number;
  riskyBurdenBps: number;
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  riskyBufferMonths: 1,
  cautionBufferMonths: 3,
  cautionRecoveryMonths: 6,
  cautionBurdenBps: 2000,
  riskyBurdenBps: 4000,
};

export type Payment =
  | { kind: "cash" }
  | { kind: "installments"; downPayment: Centimes; months: number; monthlyPayment: Centimes };

export interface AffordabilityInput {
  price: Centimes;
  /** Savings available to pay with. */
  savings: Centimes;
  monthlyIncome: Centimes;
  monthlyExpenses: Centimes;
  payment: Payment;
  /** Already set aside for active goals (part of `savings`). */
  goalsSaved: Centimes;
  /** Monthly contributions promised to active goals. */
  goalsMonthly: Centimes;
}

export type Verdict = "comfortable" | "caution" | "risky";

export interface Reason {
  severity: "caution" | "risky";
  text: string;
}

export interface Affordability {
  verdict: Verdict;
  reasons: Reason[];
  surplus: Centimes;
  /** Paid out of savings on day one (the price, or the down payment). */
  paidNow: Centimes;
  savingsAfter: Centimes;
  /** Savings left, in tenths of a month of expenses; null if expenses are zero. */
  bufferTenths: number | null;
  /** How many months of surplus the amount paid now represents; null without a surplus. */
  monthsOfSaving: number | null;
  /** Months to rebuild savings to today's level; null without a surplus. */
  recoveryMonths: number | null;
  /** Installments only. */
  totalPaid: Centimes;
  financingCost: Centimes;
  burdenBps: number | null;
  surplusAfter: Centimes;
  compromisesGoals: boolean;
}

export function assessPurchase(input: AffordabilityInput, thresholds: Thresholds = DEFAULT_THRESHOLDS): Affordability {
  const { price, savings, payment } = input;
  if (price <= 0) throw new RangeError("The price must be greater than zero");
  if (payment.kind === "installments" && (!Number.isInteger(payment.months) || payment.months < 1)) {
    throw new RangeError("Installments need a whole number of months");
  }

  const surplus = sub(input.monthlyIncome, input.monthlyExpenses);
  const installment = payment.kind === "installments" ? payment.monthlyPayment : ZERO;
  const paidNow = payment.kind === "installments" ? payment.downPayment : price;
  const totalPaid = payment.kind === "installments" ? add(paidNow, times(installment, payment.months)) : price;
  const savingsAfter = sub(savings, paidNow);
  const surplusAfter = sub(surplus, installment);

  const buffer = input.monthlyExpenses > 0 ? ratioBps(savingsAfter, input.monthlyExpenses) : null;
  const bufferTenths = buffer === null ? null : Math.floor(buffer / 1000);
  const recoveryMonths = unitsToCover(paidNow, surplusAfter);
  const monthsOfSaving = unitsToCover(paidNow, surplus);
  const burdenBps = payment.kind === "installments" && surplus > 0 ? ratioBps(installment, surplus) : null;
  const compromisesGoals = savingsAfter < input.goalsSaved || surplusAfter < input.goalsMonthly;

  const reasons: Reason[] = [];
  const risky = (text: string) => reasons.push({ severity: "risky", text });
  const caution = (text: string) => reasons.push({ severity: "caution", text });
  const months = (tenths: number) => `${Math.floor(tenths / 10)}.${tenths % 10}`;

  if (savingsAfter < 0) {
    risky("Your savings do not cover the amount due today.");
  } else if (bufferTenths !== null && bufferTenths < thresholds.riskyBufferMonths * 10) {
    risky(`It would leave ${months(bufferTenths)} months of expenses in savings (under ${thresholds.riskyBufferMonths}).`);
  } else if (bufferTenths !== null && bufferTenths < thresholds.cautionBufferMonths * 10) {
    caution(`It would leave ${months(bufferTenths)} months of expenses in savings (under ${thresholds.cautionBufferMonths}).`);
  }

  if (surplus <= 0) {
    risky("Your expenses already use all of your income, so savings would not be rebuilt.");
  } else if (payment.kind === "installments") {
    if (surplusAfter < 0) risky("The monthly payment is larger than what you have left each month.");
    else if (burdenBps !== null && burdenBps > thresholds.riskyBurdenBps) {
      risky(`The monthly payment takes ${Math.round(burdenBps / 100)}% of what you have left each month (over ${thresholds.riskyBurdenBps / 100}%).`);
    } else if (burdenBps !== null && burdenBps > thresholds.cautionBurdenBps) {
      caution(`The monthly payment takes ${Math.round(burdenBps / 100)}% of what you have left each month (over ${thresholds.cautionBurdenBps / 100}%).`);
    }
  }

  if (recoveryMonths !== null && recoveryMonths > thresholds.cautionRecoveryMonths) {
    caution(`Rebuilding your savings would take about ${recoveryMonths} months (over ${thresholds.cautionRecoveryMonths}).`);
  }
  if (compromisesGoals && savingsAfter >= 0) {
    caution(
      savingsAfter < input.goalsSaved
        ? "It would use money already set aside for your goals."
        : "What is left each month would no longer cover your goal contributions.",
    );
  }

  const verdict: Verdict = reasons.some((r) => r.severity === "risky")
    ? "risky"
    : reasons.length > 0
      ? "caution"
      : "comfortable";

  return {
    verdict,
    reasons,
    surplus,
    paidNow,
    savingsAfter,
    bufferTenths,
    monthsOfSaving,
    recoveryMonths,
    totalPaid,
    financingCost: sub(totalPaid, price),
    burdenBps,
    surplusAfter,
    compromisesGoals,
  };
}
