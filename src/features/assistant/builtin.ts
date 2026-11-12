/**
 * Built-in answers: the assistant with no AI at all.
 *
 * Common questions are recognised by their wording and answered by calling
 * the same tools a language model would. Nothing leaves the computer, there
 * is nothing to install, and every figure comes from a tool result. It
 * understands less than a model would, and says so when it does not
 * recognise a question.
 */

import { MoneyError, parseAmount, type Centimes } from "../../engine";
import { runTool, type ToolCall, type ToolContext } from "./tools";

export interface Answer {
  text: string;
  calls: ToolCall[];
}

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  eighteen: 18, "twenty-four": 24,
};

/** "in one year", "over 18 months", "last three months" -> months. */
export function readMonths(question: string): number | null {
  const q = question.toLowerCase();
  for (const match of q.matchAll(/\b(\d+|[a-z-]+)\s+(month|year)s?\b/g)) {
    const count = /^\d+$/.test(match[1]) ? Number(match[1]) : WORD_NUMBERS[match[1]];
    if (count) return match[2] === "year" ? count * 12 : count;
  }
  return /\bnext month\b/.test(q) ? 1 : null;
}

/** The first amount in the question that is not a count of months or years. */
export function readAmountIn(question: string): Centimes | null {
  for (const match of question.matchAll(/\d[\d.,\s ]*\d|\d/g)) {
    const after = question.slice((match.index ?? 0) + match[0].length);
    if (/^\s*(months?|years?|%)/i.test(after)) continue;
    try {
      const amount = parseAmount(match[0].trim());
      if (amount > 0) return amount;
    } catch (error) {
      if (!(error instanceof MoneyError)) throw error;
    }
  }
  return null;
}

type Result = Record<string, any>; // tool results are plain JSON; shapes are defined in tools.ts

const HELP =
  "I can answer questions like: how much did I spend this month, what are my biggest expenses, compare my spending over " +
  "the last three months, how much can I safely spend, can I afford 8,000, what happens if I save 1,500 every month, how much " +
  "should I save to buy a car in one year, and which goal should I prioritize. I did not recognise this one.";

export function answerBuiltIn(question: string, context: ToolContext): Answer {
  const q = question.toLowerCase();
  const calls: ToolCall[] = [];
  const call = (name: string, args: Record<string, unknown> = {}): Result => {
    const done = runTool(context, name, args);
    calls.push(done);
    return done.result as Result;
  };
  const dirhamsOf = (amount: Centimes) => amount / 100; // tool arguments are plain dirhams
  const goal = context.ledger.goals.find((g) => g.status === "active" && q.includes(g.name.toLowerCase()));
  const amount = readAmountIn(question);
  const months = readMonths(question);
  const reply = (text: string): Answer => ({ text, calls });

  if (/priorit/.test(q)) {
    const { goals } = call("goals");
    if (goals.length === 0) return reply("You have no active goals yet. Add one under Purchase Goals.");
    const lines = goals.map((g: Result) =>
      `${g.priority}. ${g.name}: ${g.still_to_save} still to save, ` +
      (g.months_until_affordable === null ? "no monthly contribution set" : `ready by ${g.ready_by} at ${g.saving_per_month} a month`) +
      (g.on_track === false ? `, behind the date you wanted (${g.wanted_by})` : ""),
    );
    const behind = goals.find((g: Result) => g.on_track === false);
    return reply(
      `By the priorities you set:\n${lines.join("\n")}\n` +
        (behind
          ? `${behind.name} is behind its date: it needs ${behind.needed_per_month_for_wanted_date} a month to be ready by ${behind.wanted_by}.`
          : "None of them is behind a date you set.") +
        " Which matters more is your call; these are the figures.",
    );
  }

  if (/how much (should|do|must) i (save|need)|save to (buy|afford|reach)/.test(q) && (goal || amount) && months) {
    const args = goal
      ? { amount: 0, months, already_saved: dirhamsOf(goal.savedAmount) }
      : { amount: dirhamsOf(amount!), months };
    if (goal) {
      const [g] = call("goals", { name: goal.name }).goals;
      args.amount = Number(String(g.needed_on_purchase_day).replace(/[^\d.]/g, ""));
    }
    const r = call("required_saving", args);
    return reply(
      `To have ${r.amount}${goal ? ` for the ${goal.name} (price plus one-off costs)` : ""} in ${r.months} months, starting from ${r.already_saved} already saved, ` +
        `you need to save ${r.needed_per_month} a month.` +
        (r.average_left_each_month ? ` On average you have ${r.average_left_each_month} left each month.` : ""),
    );
  }

  if (/afford|can i buy|when (can|will) i/.test(q)) {
    if (goal) {
      const [g] = call("goals", { name: goal.name }).goals;
      const price = Number(String(g.needed_on_purchase_day).replace(/[^\d.]/g, ""));
      const a = call("assess_purchase", { price });
      const today = a.cannot_assess
        ? a.cannot_assess
        : `Buying it today from savings would be ${label(a.verdict)}: savings would go from ${a.savings_today} to ${a.savings_afterwards}.` +
          (a.reasons.length ? ` ${a.reasons.join(" ")}` : "");
      return reply(
        `The ${g.name} needs ${g.needed_on_purchase_day} on purchase day (${g.purchase_price} plus ${g.one_off_costs} of one-off costs). ` +
          `You have set aside ${g.saved}, so ${g.still_to_save} remains. ` +
          (g.months_until_affordable === null
            ? "No monthly contribution is set for it. "
            : `At ${g.saving_per_month} a month it is covered in ${g.months_until_affordable} months, by ${g.ready_by}. `) +
          `Owning it then costs about ${g.cost_of_owning_per_month} a month. ${today}`,
      );
    }
    if (amount) {
      const a = call("assess_purchase", { price: dirhamsOf(amount) });
      if (a.cannot_assess) return reply(a.cannot_assess);
      return reply(
        `Paying ${a.price} from savings today would be ${label(a.verdict)}. Savings would go from ${a.savings_today} to ${a.savings_afterwards}` +
          (a.months_of_expenses_left === null ? "" : `, which covers ${a.months_of_expenses_left} months of expenses`) +
          (a.months_to_rebuild_savings === null ? "." : `, and take about ${a.months_to_rebuild_savings} months to rebuild.`) +
          (a.reasons.length ? ` ${a.reasons.join(" ")}` : "") +
          ` ${a.note}`,
      );
    }
    return reply("Tell me the price, or name one of your goals, and I will assess it. For example: can I afford 8,000?");
  }

  if (/\bsav(e|ing)\b/.test(q) && amount && /(every|each|per|a) month|monthly|if i/.test(q)) {
    const r = call("project_savings", { monthly_contribution: dirhamsOf(amount), months: months ?? 12 });
    return reply(
      `Saving ${r.monthly_contribution} every month, your savings go from ${r.savings_today} today to ${r.savings_then} after ${r.after_months} months. ${r.assumption}`,
    );
  }

  if (/compare|last \w+ months|past \w+ months|over the last/.test(q)) {
    const r = call("spending_history", { months: months ?? 3 });
    const lines = r.months.map((m: Result) => `${m.month}${m.partial_month ? " (so far)" : ""}: spent ${m.expenses}, earned ${m.income}, net ${m.net}`);
    return reply(`Your last ${r.months.length} months:\n${lines.join("\n")}`);
  }

  if (/biggest|largest|top|most|where (is|does|did) my money/.test(q)) {
    const r = call("monthly_summary");
    if (r.categories.length === 0) return reply(`No expenses are recorded for ${r.month} yet.`);
    const lines = r.categories.slice(0, 5).map((c: Result, i: number) => `${i + 1}. ${c.category}: ${c.spent} (${c.share})`);
    return reply(`Your biggest expenses in ${r.month}${r.partial_month ? " so far" : ""}, out of ${r.expenses}:\n${lines.join("\n")}`);
  }

  if (/(more|less|increase|decrease|change|up|down)\b/.test(q) && /spen|expens/.test(q)) {
    const r = call("compare_spending");
    const lines = r.changes.slice(0, 5).map((c: Result) => `${c.category}: ${c.this_month} against ${c.previous_month} (${c.change})`);
    return reply(`${r.month} compared with ${r.previous}:\n${lines.join("\n")}${r.note ? `\n${r.note}` : ""}`);
  }

  if (/spen[dt]|expenses?/.test(q) && !/safe|can i|limit/.test(q)) {
    const r = call("monthly_summary");
    return reply(
      `In ${r.month}${r.partial_month ? " so far" : ""} you spent ${r.expenses}: ${r.fixed_expenses} fixed and ${r.variable_expenses} variable, ` +
        `across ${r.transactions} recorded transactions. Income was ${r.income}, leaving ${r.net}.`,
    );
  }

  if (/safe|can i spend|left to spend|spending limit|budget/.test(q)) {
    const r = call("safe_to_spend");
    return reply(
      `You can still spend ${r.safe_to_spend} in ${r.month}` +
        (r.per_day ? `, about ${r.per_day} a day over the ${r.days_left} days left.` : ".") +
        ` That is a limit of ${r.spending_limit} minus ${r.variable_spending_so_far} of variable spending so far. The full calculation is listed below.`,
    );
  }

  if (/on track|situation|how am i doing|net worth|balance|how much (do i have|can i save)|my savings/.test(q)) {
    const r = call("current_position");
    return reply(
      `You have ${r.available} available and ${r.savings} in savings, a net worth of ${r.net_worth}. ` +
        (r.complete_months_of_history === 0
          ? "There is not yet a complete month of records to average."
          : `Over your last ${r.complete_months_of_history} complete months you earned ${r.average_monthly_income} and spent ${r.average_monthly_expenses} a month on average, ` +
            `leaving ${r.average_left_each_month} (a savings rate of ${r.average_savings_rate}). Your net worth covers ${r.months_of_expenses_covered} months of expenses.`),
    );
  }

  return reply(HELP);
}

function label(verdict: string): string {
  return verdict === "comfortable" ? "comfortable" : verdict === "caution" ? "possible, but requires caution" : "financially risky";
}
