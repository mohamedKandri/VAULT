import { useMemo } from "react";
import { useLedger } from "../../data/LedgerContext";
import { ZERO, financialHealth, planGoal, positionAt, sub, sum, type Centimes, type Goal, type GoalPlan } from "../../engine";

export interface Baseline {
  /** Complete months of history behind the averages (0 = none: averages are zero). */
  monthsUsed: number;
  income: Centimes;
  expenses: Centimes;
  variable: Centimes;
  /** Average income minus expenses; null without a complete month of records. */
  surplus: Centimes | null;
  savings: Centimes;
  available: Centimes;
  activeGoals: { goal: Goal; plan: GoalPlan }[];
  goalsSaved: Centimes;
  goalsMonthly: Centimes;
}

/** The user's current figures, used to pre-fill the planning tools. */
export function useBaseline(): Baseline {
  const { ledger, today } = useLedger();
  return useMemo(() => {
    const health = financialHealth(ledger.accounts, ledger.transactions, today);
    const position = positionAt(ledger.accounts, ledger.transactions.filter((t) => t.date <= today), today);
    const income = health.averageIncome ?? ZERO;
    const expenses = health.averageExpenses ?? ZERO;
    const surplus = health.monthsUsed > 0 ? sub(income, expenses) : null;
    const active = ledger.goals.filter((g) => g.status === "active");
    return {
      monthsUsed: health.monthsUsed,
      income,
      expenses,
      variable: health.averageVariable ?? ZERO,
      surplus,
      savings: position?.savings ?? ZERO,
      available: position?.available ?? ZERO,
      activeGoals: active.map((goal) => ({ goal, plan: planGoal(goal, today, surplus) })),
      goalsSaved: sum(active.map((g) => g.savedAmount)),
      goalsMonthly: sum(active.map((g) => g.monthlyContribution)),
    };
  }, [ledger, today]);
}

export const basisText = (monthsUsed: number) =>
  monthsUsed === 0
    ? "No complete month of records yet, so nothing is pre-filled. Enter your own figures."
    : `Pre-filled from your records: averages of the last ${monthsUsed} complete ${monthsUsed === 1 ? "month" : "months"} and today's balances.`;
