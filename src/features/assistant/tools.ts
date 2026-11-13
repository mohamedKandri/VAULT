/**
 * The assistant's tools: the only way any answer gets a number.
 *
 * Each tool is a thin wrapper over an engine function. A language model (or
 * the built-in question matcher) chooses which tool to call and with what
 * arguments; the tool runs locally and returns figures. The model never does
 * arithmetic and never sees the transaction table, only these results.
 *
 * Results carry amounts already formatted ("MAD 1,500.00") so the text of an
 * answer can be checked against them.
 */

import type { Ledger } from "../../data/ledger";
import {
  ZERO,
  addMonths,
  addMonthsToYearMonth,
  assessPurchase,
  compareCategorySpending,
  dirhams,
  financialHealth,
  formatBps,
  formatMAD,
  monthOf,
  parseYearMonth,
  planGoal,
  positionAt,
  projectSavings,
  safeToSpend,
  sub,
  sum,
  summarizeMonth,
  type Centimes,
  type IsoDate,
  type YearMonth,
} from "../../engine";
import { monthLong, monthYear } from "../../ui/format";

export interface ToolContext {
  ledger: Ledger;
  today: IsoDate;
}

export interface Tool {
  name: string;
  description: string;
  /** JSON Schema of the arguments, as sent to a model. */
  parameters: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (context: ToolContext, args: Record<string, unknown>) => unknown;
}

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

const money = (amount: Centimes | null) => (amount === null ? null : formatMAD(amount));
const percent = (bps: number | null) => (bps === null ? null : formatBps(Math.round(bps / 10) * 10));

function readMonth(value: unknown, fallback: YearMonth): YearMonth {
  if (typeof value !== "string" || value === "") return fallback;
  parseYearMonth(value); // throws on anything that is not YYYY-MM
  return value;
}

function readAmount(value: unknown, name: string): Centimes {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e12) {
    throw new Error(`"${name}" must be a non-negative amount in dirhams`);
  }
  return dirhams(Math.round(value));
}

function readCount(value: unknown, fallback: number, max: number): number {
  const n = typeof value === "number" && Number.isInteger(value) ? value : fallback;
  return Math.min(max, Math.max(1, n));
}

function baseline({ ledger, today }: ToolContext) {
  const health = financialHealth(ledger.accounts, ledger.transactions, today);
  const position = positionAt(ledger.accounts, ledger.transactions.filter((t) => t.date <= today), today);
  const surplus = health.monthsUsed > 0 ? sub(health.averageIncome ?? ZERO, health.averageExpenses ?? ZERO) : null;
  return { health, position, surplus };
}

const categoryName = (ledger: Ledger, id: string) => ledger.categories.find((c) => c.id === id)?.name ?? "Uncategorized";

export const TOOLS: Tool[] = [
  {
    name: "monthly_summary",
    description: "Income, expenses (fixed and variable), net and savings rate for one month, with expenses by category.",
    parameters: { type: "object", properties: { month: { type: "string", description: "YYYY-MM. Defaults to the current month." } } },
    run: (ctx, args) => {
      const month = readMonth(args.month, monthOf(ctx.today));
      const s = summarizeMonth(ctx.ledger.transactions.filter((t) => t.date <= ctx.today), month);
      return {
        month: monthLong(month),
        partial_month: month === monthOf(ctx.today),
        income: money(s.income),
        expenses: money(s.expenses),
        fixed_expenses: money(s.fixedExpenses),
        variable_expenses: money(s.variableExpenses),
        net: money(s.net),
        savings_rate: percent(s.savingsRateBps),
        categories: s.expensesByCategory.map((c) => ({ category: categoryName(ctx.ledger, c.categoryId), spent: money(c.total), share: percent(c.shareBps) })),
        transactions: s.transactionCount,
      };
    },
  },
  {
    name: "compare_spending",
    description: "Change in spending per category between two months.",
    parameters: {
      type: "object",
      properties: { month: { type: "string", description: "YYYY-MM. Defaults to the current month." }, previous: { type: "string", description: "YYYY-MM. Defaults to the month before." } },
    },
    run: (ctx, args) => {
      const month = readMonth(args.month, monthOf(ctx.today));
      const previous = readMonth(args.previous, addMonthsToYearMonth(month, -1));
      const recorded = ctx.ledger.transactions.filter((t) => t.date <= ctx.today);
      return {
        month: monthLong(month),
        previous: monthLong(previous),
        note: month === monthOf(ctx.today) ? "The current month is not finished, so it is compared with a full previous month." : undefined,
        changes: compareCategorySpending(recorded, month, previous).map((c) => ({
          category: categoryName(ctx.ledger, c.categoryId),
          this_month: money(c.current),
          previous_month: money(c.previous),
          difference: formatMAD(c.delta, { signed: true }),
          change: c.changeBps === null ? "new this month" : formatBps(Math.round(c.changeBps / 10) * 10, { signed: true }),
        })),
      };
    },
  },
  {
    name: "spending_history",
    description: "Total income and expenses for each of the last N months, oldest first.",
    parameters: { type: "object", properties: { months: { type: "integer", description: "How many months, 1-24. Default 3." } } },
    run: (ctx, args) => {
      const count = readCount(args.months, 3, 24);
      const recorded = ctx.ledger.transactions.filter((t) => t.date <= ctx.today);
      const current = monthOf(ctx.today);
      return {
        months: Array.from({ length: count }, (_, i) => {
          const month = addMonthsToYearMonth(current, i - count + 1);
          const s = summarizeMonth(recorded, month);
          return { month: monthLong(month), partial_month: month === current, income: money(s.income), expenses: money(s.expenses), net: money(s.net) };
        }),
      };
    },
  },
  {
    name: "current_position",
    description: "Balances today: available money (current and cash accounts), savings and net worth, plus averages over recent complete months.",
    parameters: { type: "object", properties: {} },
    run: (ctx) => {
      const { health, position, surplus } = baseline(ctx);
      return {
        available: money(position?.available ?? null),
        savings: money(position?.savings ?? null),
        net_worth: money(position?.netWorth ?? null),
        complete_months_of_history: health.monthsUsed,
        average_monthly_income: money(health.averageIncome),
        average_monthly_expenses: money(health.averageExpenses),
        average_left_each_month: money(surplus),
        months_of_expenses_covered: health.coverTenths === null ? null : health.coverTenths / 10,
        average_savings_rate: percent(health.savingsRateBps),
      };
    },
  },
  {
    name: "safe_to_spend",
    description: "How much can still be spent this month after fixed and scheduled expenses and savings transfers, with the full calculation.",
    parameters: { type: "object", properties: {} },
    run: (ctx) => {
      const b = safeToSpend(ctx.ledger.accounts, ctx.ledger.transactions, ctx.ledger.schedules, ctx.today);
      return {
        month: monthLong(b.month),
        safe_to_spend: money(b.remaining),
        spending_limit: money(b.spendingLimit),
        variable_spending_so_far: money(b.variableSpent),
        days_left: b.daysLeft,
        per_day: money(b.perDay),
        calculation: b.lines.map((l) => ({ line: l.label, amount: formatMAD(l.amount, { signed: true }) })),
      };
    },
  },
  {
    name: "project_savings",
    description: "Project savings forward with a fixed monthly contribution. Straight arithmetic, no interest.",
    parameters: {
      type: "object",
      properties: {
        monthly_contribution: { type: "number", description: "Dirhams saved each month." },
        months: { type: "integer", description: "How many months to project, 1-120. Default 12." },
        target: { type: "number", description: "Optional target amount in dirhams." },
      },
      required: ["monthly_contribution"],
    },
    run: (ctx, args) => {
      const contribution = readAmount(args.monthly_contribution, "monthly_contribution");
      const months = readCount(args.months, 12, 120);
      const target = args.target === undefined || args.target === null ? null : readAmount(args.target, "target");
      const { position } = baseline(ctx);
      const start = position?.savings ?? ZERO;
      // Income equal to the contribution and zero expenses: the projection is exactly "start + n x contribution".
      const p = projectSavings(
        { startingSavings: start, monthlyIncome: contribution, additionalIncome: ZERO, monthlyExpenses: ZERO, monthlyContribution: contribution, target },
        months,
        monthOf(ctx.today),
      );
      return {
        savings_today: money(start),
        monthly_contribution: money(contribution),
        after_months: months,
        savings_then: money(p.finalSavings),
        target: money(target),
        months_to_target: p.monthsToTarget,
        target_reached_in: p.monthsToTarget ? monthYear(addMonths(ctx.today, p.monthsToTarget)) : null,
        assumption: "The same amount is added every month. No interest or inflation.",
      };
    },
  },
  {
    name: "goals",
    description: "All active purchase goals with their full cost, progress, estimated date and cost of ownership.",
    parameters: { type: "object", properties: { name: { type: "string", description: "Optional: only goals whose name contains this text." } } },
    run: (ctx, args) => {
      const { surplus } = baseline(ctx);
      const filter = typeof args.name === "string" ? args.name.trim().toLowerCase() : "";
      const goals = ctx.ledger.goals.filter((g) => g.status === "active" && (!filter || g.name.toLowerCase().includes(filter)));
      return {
        average_left_each_month: money(surplus),
        goals: goals.map((goal) => {
          const plan = planGoal(goal, ctx.today, surplus);
          return {
            name: goal.name,
            priority: goal.priority,
            purchase_price: money(goal.targetPrice),
            one_off_costs: money(plan.oneOffCosts),
            needed_on_purchase_day: money(plan.upfrontTotal),
            saved: money(goal.savedAmount),
            still_to_save: money(plan.remaining),
            progress: percent(plan.progressBps),
            saving_per_month: money(goal.monthlyContribution),
            months_until_affordable: plan.monthsAtContribution,
            ready_by: plan.estimatedDate ? monthYear(plan.estimatedDate) : null,
            wanted_by: goal.targetDate ? monthYear(goal.targetDate) : null,
            needed_per_month_for_wanted_date: money(plan.requiredMonthly),
            on_track: plan.onTrack,
            cost_of_owning_per_month: money(plan.monthlyOwnership),
            first_year_total: money(plan.firstYearCost),
            left_each_month_after_buying: money(plan.surplusAfterPurchase),
          };
        }),
      };
    },
  },
  {
    name: "required_saving",
    description: "Monthly saving needed to reach an amount within a number of months, starting from what is already saved for it.",
    parameters: {
      type: "object",
      properties: {
        amount: { type: "number", description: "Total needed, in dirhams." },
        months: { type: "integer", description: "Months available, 1-600." },
        already_saved: { type: "number", description: "Dirhams already set aside. Default 0." },
      },
      required: ["amount", "months"],
    },
    run: (ctx, args) => {
      const amount = readAmount(args.amount, "amount");
      const months = readCount(args.months, 12, 600);
      const saved = args.already_saved === undefined ? ZERO : readAmount(args.already_saved, "already_saved");
      const plan = planGoal(
        { id: "x", name: "x", targetPrice: amount, savedAmount: saved, targetDate: addMonths(ctx.today, months), monthlyContribution: ZERO, priority: 1, status: "active", costs: [] },
        ctx.today,
        baseline(ctx).surplus,
      );
      return {
        amount: money(amount),
        already_saved: money(saved),
        still_to_save: money(plan.remaining),
        months,
        needed_per_month: money(plan.requiredMonthly),
        average_left_each_month: money(baseline(ctx).surplus),
      };
    },
  },
  {
    name: "assess_purchase",
    description: "Rule-based assessment of buying something now, paid in full from savings: comfortable, caution or risky, with reasons.",
    parameters: { type: "object", properties: { price: { type: "number", description: "Price in dirhams." } }, required: ["price"] },
    run: (ctx, args) => {
      const price = readAmount(args.price, "price");
      const { health, position } = baseline(ctx);
      if (health.monthsUsed === 0 || !position) {
        return { cannot_assess: "This needs at least one complete month of income and expense records, and an account balance." };
      }
      const active = ctx.ledger.goals.filter((g) => g.status === "active");
      const a = assessPurchase({
        price,
        savings: position.savings,
        monthlyIncome: health.averageIncome ?? ZERO,
        monthlyExpenses: health.averageExpenses ?? ZERO,
        payment: { kind: "cash" },
        goalsSaved: sum(active.map((g) => g.savedAmount)),
        goalsMonthly: sum(active.map((g) => g.monthlyContribution)),
      });
      return {
        price: money(price),
        verdict: a.verdict,
        reasons: a.reasons.map((r) => r.text),
        savings_today: money(position.savings),
        savings_afterwards: money(a.savingsAfter),
        months_of_expenses_left: a.bufferTenths === null ? null : a.bufferTenths / 10,
        months_to_rebuild_savings: a.recoveryMonths,
        affects_goals: a.compromisesGoals,
        note: "Guidance from fixed rules, not a guarantee and not financial advice.",
      };
    },
  },
];

export const toolByName = new Map(TOOLS.map((t) => [t.name, t]));

/** Run one tool call; a bad name or bad arguments become an error result instead of an exception. */
export function runTool(context: ToolContext, name: string, args: Record<string, unknown>): ToolCall {
  const tool = toolByName.get(name);
  if (!tool) return { name, args, result: { error: `There is no tool named "${name}".` } };
  try {
    return { name, args, result: tool.run(context, args ?? {}) };
  } catch (error) {
    return { name, args, result: { error: error instanceof Error ? error.message : String(error) } };
  }
}

/**
 * Figures in an answer that appear in no tool result. A model can still
 * misquote a number; this lets the interface mark it instead of trusting it.
 * Only amounts of 100 or more are checked (small counts such as "3 months"
 * are everywhere and prove nothing).
 */
export function unverifiedFigures(answer: string, calls: readonly ToolCall[]): string[] {
  const digits = (text: string) => text.replace(/[,\s ]/g, "").replace(/\.00$/, "");
  const known = new Set<string>();
  const collect = (value: unknown) => {
    if (typeof value === "number") known.add(String(value));
    else if (typeof value === "string") for (const m of value.matchAll(/\d[\d,]*(?:\.\d+)?/g)) known.add(digits(m[0]));
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  calls.forEach((call) => collect(call.result));
  const unverified = new Set<string>();
  for (const match of answer.matchAll(/\d[\d,\s ]*\d(?:\.\d+)?|\d+(?:\.\d+)?/g)) {
    const value = digits(match[0]);
    if (Number(value) >= 100 && !known.has(value) && !/^(19|20)\d\d$/.test(value)) unverified.add(match[0].trim());
  }
  return [...unverified];
}
