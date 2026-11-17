/**
 * Insights: short statements about the user's money, each computed from
 * records by the engine and returned with the lines that produced it.
 *
 * Nothing here is a prediction or a judgement the user cannot check: every
 * insight carries its `basis`, and an insight is only produced when the data
 * behind it is meaningful (thresholds below).
 */

import type { Ledger } from "../../data/ledger";
import {
  addMonths,
  addMonthsToYearMonth,
  financialHealth,
  formatBps,
  formatMAD,
  monthOf,
  planGoal,
  safeToSpend,
  sub,
  summarizeMonth,
  type Centimes,
  type IsoDate,
} from "../../engine";
import { dayMonth, monthLong, monthYear } from "../../ui/format";

export type InsightTone = "positive" | "neutral" | "caution";

export interface Insight {
  id: string;
  tone: InsightTone;
  text: string;
  /** How the figures were obtained, one line each. */
  basis: string[];
}

/** A category change is mentioned only if it is at least this large... */
export const MIN_CHANGE_BPS = 1500;
/** ...and moves at least this much money (MAD 100). */
export const MIN_CHANGE_AMOUNT = 10_000;
/** Below this many months of expenses covered, the cushion is flagged. */
export const LOW_COVER_TENTHS = 30;

const mad = (amount: Centimes) => formatMAD(amount, { decimals: "auto" });
const pct = (bps: number) => formatBps(Math.round(Math.abs(bps) / 100) * 100);

export function buildInsights(ledger: Ledger, today: IsoDate): Insight[] {
  const insights: Insight[] = [];
  const recorded = ledger.transactions.filter((t) => t.date <= today);
  const month = monthOf(today);

  // 1. What is left to spend this month.
  const budget = safeToSpend(ledger.accounts, ledger.transactions, ledger.schedules, today);
  if (budget.expectedIncome > 0) {
    const basis = [...budget.lines.filter((l) => l.amount !== 0).map((l) => `${l.label}: ${formatMAD(l.amount, { signed: true })}`), `Result: ${formatMAD(budget.remaining)}`];
    if (budget.remaining < 0) {
      insights.push({
        id: "budget",
        tone: "caution",
        text: `You are ${mad(sub(0 as Centimes, budget.remaining))} over what ${monthLong(month)} allows after planned expenses and savings transfers.`,
        basis,
      });
    } else {
      insights.push({
        id: "budget",
        tone: "neutral",
        text:
          `You have ${mad(budget.remaining)} available for the rest of ${monthLong(month)} after planned expenses and savings transfers` +
          (budget.perDay !== null ? `, about ${mad(budget.perDay)} a day.` : "."),
        basis,
      });
    }
  }

  // 2. Spending changes per category, compared with the same days of last month.
  const previous = addMonthsToYearMonth(month, -1);
  const previousEnd = addMonths(today, -1);
  const current = summarizeMonth(recorded, month).expensesByCategory;
  const before = new Map(
    summarizeMonth(recorded.filter((t) => monthOf(t.date) !== previous || t.date <= previousEnd), previous).expensesByCategory.map((c) => [c.categoryId, c.total]),
  );
  const names = new Map(ledger.categories.map((c) => [c.id, c.name]));
  const changes = current
    .map((c) => ({ id: c.categoryId, now: c.total, then: before.get(c.categoryId) ?? (0 as Centimes) }))
    .filter((c) => c.then > 0)
    .map((c) => ({ ...c, delta: sub(c.now, c.then), bps: Math.round(((c.now - c.then) * 10_000) / c.then) }))
    .filter((c) => Math.abs(c.bps) >= MIN_CHANGE_BPS && Math.abs(c.delta) >= MIN_CHANGE_AMOUNT)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 2);
  const period = (end: IsoDate) => `1–${dayMonth(end)}`;
  for (const c of changes) {
    const name = names.get(c.id) ?? "Uncategorized";
    const more = c.delta > 0;
    insights.push({
      id: `category-${c.id}`,
      tone: more ? "caution" : "positive",
      text: `You spent ${pct(c.bps)} ${more ? "more" : "less"} on ${name.toLowerCase()} than in the same days of ${monthLong(previous)}: ${mad(c.now)} against ${mad(c.then)}.`,
      basis: [
        `${name}, ${period(today)}: ${formatMAD(c.now)}`,
        `${name}, ${period(previousEnd)}: ${formatMAD(c.then)}`,
        `Difference: ${formatMAD(c.delta, { signed: true })} = ${formatBps(Math.round(c.bps / 100) * 100, { signed: true })}`,
        `Shown when the change is at least ${MIN_CHANGE_BPS / 100}% and ${mad(MIN_CHANGE_AMOUNT as Centimes)}.`,
      ],
    });
  }

  // 3. The most important goal still being saved for.
  const health = financialHealth(ledger.accounts, ledger.transactions, today);
  const goal = ledger.goals
    .filter((g) => g.status === "active")
    .sort((a, b) => a.priority - b.priority)
    .find((g) => planGoal(g, today, null).remaining > 0);
  if (goal) {
    const plan = planGoal(goal, today, null);
    const basis = [
      `Needed on purchase day: ${formatMAD(goal.targetPrice)} price + ${formatMAD(plan.oneOffCosts)} one-off costs = ${formatMAD(plan.upfrontTotal)}`,
      `Already saved for it: ${formatMAD(goal.savedAmount)}`,
      `Still to save: ${formatMAD(plan.remaining)}`,
    ];
    if (plan.monthsAtContribution === null) {
      insights.push({ id: "goal", tone: "caution", text: `No monthly saving is set for the ${goal.name}, so it has no date. ${mad(plan.remaining)} is still needed.`, basis });
    } else {
      basis.push(`${formatMAD(plan.remaining)} ÷ ${formatMAD(goal.monthlyContribution)} a month = ${plan.monthsAtContribution} months, rounded up`);
      const late = plan.onTrack === false;
      if (late) basis.push(`To be ready by ${monthYear(goal.targetDate!)}: ${formatMAD(plan.remaining)} ÷ ${plan.monthsUntilTarget} months = ${formatMAD(plan.requiredMonthly!)} a month`);
      insights.push({
        id: "goal",
        tone: late ? "caution" : "neutral",
        text:
          `At ${mad(goal.monthlyContribution)} a month, the ${goal.name} is covered in about ${plan.monthsAtContribution} ${plan.monthsAtContribution === 1 ? "month" : "months"} (${monthYear(plan.estimatedDate!)}).` +
          (late ? ` That is after the ${monthYear(goal.targetDate!)} you set; it would take ${mad(plan.requiredMonthly!)} a month.` : ""),
        basis,
      });
    }
  }

  // 4. A thin cushion.
  if (health.coverTenths !== null && health.coverTenths < LOW_COVER_TENTHS && health.averageExpenses) {
    insights.push({
      id: "cover",
      tone: "caution",
      text:
        health.coverTenths <= 0
          ? "Your balances do not cover a single month of expenses."
          : `Your balances cover about ${(health.coverTenths / 10).toFixed(1)} months of expenses.`,
      basis: [
        `Average monthly expenses over the last ${health.monthsUsed} complete ${health.monthsUsed === 1 ? "month" : "months"}: ${formatMAD(health.averageExpenses)}`,
        `Net worth today divided by that average`,
        `Shown when under ${LOW_COVER_TENTHS / 10} months.`,
      ],
    });
  }

  return insights;
}
