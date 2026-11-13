import { describe, expect, it } from "vitest";
import { buildDemoLedger } from "../../data/demoLedger";
import { EMPTY_LEDGER } from "../../data/ledger";
import { dirhams, formatMAD, monthOf, planGoal, positionAt, safeToSpend, summarizeMonth } from "../../engine";
import { answerBuiltIn, readAmountIn, readMonths } from "./builtin";
import { TOOLS, runTool, unverifiedFigures, type ToolContext } from "./tools";

const today = "2026-11-12";
const ledger = buildDemoLedger(today);
const ctx: ToolContext = { ledger, today };
const ask = (question: string, context = ctx) => answerBuiltIn(question, context);

describe("tools", () => {
  it("have unique names and valid schemas", () => {
    expect(new Set(TOOLS.map((t) => t.name)).size).toBe(TOOLS.length);
    for (const tool of TOOLS) {
      expect(tool.parameters.type).toBe("object");
      expect(tool.description.length).toBeGreaterThan(20);
    }
  });

  it("return exactly what the engine computes", () => {
    const summary = summarizeMonth(ledger.transactions, monthOf(today));
    expect(runTool(ctx, "monthly_summary", {}).result).toMatchObject({ expenses: formatMAD(summary.expenses), income: formatMAD(summary.income) });
    const position = positionAt(ledger.accounts, ledger.transactions, today)!;
    expect(runTool(ctx, "current_position", {}).result).toMatchObject({ savings: formatMAD(position.savings), net_worth: formatMAD(position.netWorth) });
    const budget = safeToSpend(ledger.accounts, ledger.transactions, ledger.schedules, today);
    expect(runTool(ctx, "safe_to_spend", {}).result).toMatchObject({ safe_to_spend: formatMAD(budget.remaining), days_left: 19 });
  });

  it("turn bad calls into error results instead of throwing", () => {
    expect(runTool(ctx, "launch_rockets", {}).result).toEqual({ error: 'There is no tool named "launch_rockets".' });
    expect(runTool(ctx, "monthly_summary", { month: "November" }).result).toHaveProperty("error");
    expect(runTool(ctx, "project_savings", { monthly_contribution: -5 }).result).toHaveProperty("error");
    expect(runTool(ctx, "assess_purchase", { price: "a lot" }).result).toHaveProperty("error");
  });

  it("project savings as start + n x contribution", () => {
    const start = positionAt(ledger.accounts, ledger.transactions, today)!.savings;
    const r = runTool(ctx, "project_savings", { monthly_contribution: 1500, months: 12, target: 100_000 }).result as Record<string, unknown>;
    expect(r.savings_then).toBe(formatMAD(dirhams(start / 100 + 18_000)));
    expect(r.months_to_target).toBe(Math.ceil((100_000 - start / 100) / 1500));
  });

  it("refuse to assess a purchase without history", () => {
    expect(runTool({ ledger: EMPTY_LEDGER, today }, "assess_purchase", { price: 500 }).result).toHaveProperty("cannot_assess");
  });
});

describe("question parsing", () => {
  it("reads periods", () => {
    expect(readMonths("in one year")).toBe(12);
    expect(readMonths("over the last three months")).toBe(3);
    expect(readMonths("for 18 months")).toBe(18);
    expect(readMonths("next month?")).toBe(1);
    expect(readMonths("can I afford it")).toBeNull();
  });

  it("reads amounts but not month counts", () => {
    expect(readAmountIn("What happens if I save MAD 1,500 every month?")).toBe(dirhams(1500));
    expect(readAmountIn("save 2000 for 18 months")).toBe(dirhams(2000));
    expect(readAmountIn("over 12 months")).toBeNull();
    expect(readAmountIn("no numbers here")).toBeNull();
  });
});

describe("built-in answers", () => {
  const cases: [string, string][] = [
    ["How much did I spend this month?", "monthly_summary"],
    ["What are my biggest expenses?", "monthly_summary"],
    ["Compare my spending over the last three months.", "spending_history"],
    ["What happens if I save MAD 1,500 every month?", "project_savings"],
    ["Which financial goal should I prioritize?", "goals"],
    ["How much can I safely spend this month?", "safe_to_spend"],
    ["Am I financially on track?", "current_position"],
    ["Can I afford 8,000?", "assess_purchase"],
  ];

  it.each(cases)("answers %j with %s and only verified figures", (question, tool) => {
    const answer = ask(question);
    expect(answer.calls.map((c) => c.name)).toContain(tool);
    expect(answer.calls.every((c) => !(c.result as Record<string, unknown>).error)).toBe(true);
    expect(unverifiedFigures(answer.text, answer.calls)).toEqual([]);
    expect(answer.text.length).toBeGreaterThan(40);
  });

  it("answers 'can I afford a motorcycle next month' from the goal and an assessment", () => {
    const answer = ask("Can I afford a motorcycle next month?");
    expect(answer.calls.map((c) => c.name)).toEqual(["goals", "assess_purchase"]);
    const goal = ledger.goals.find((g) => g.name === "Motorcycle")!;
    const plan = planGoal(goal, today, null);
    expect(answer.text).toContain(formatMAD(plan.upfrontTotal));
    expect(answer.text).toContain(formatMAD(plan.remaining));
    expect(answer.calls[1].args).toEqual({ price: plan.upfrontTotal / 100 });
    expect(unverifiedFigures(answer.text, answer.calls)).toEqual([]);
  });

  it("answers 'how much should I save to buy a car in one year'", () => {
    const answer = ask("How much should I save to buy a car in one year?");
    const car = ledger.goals.find((g) => g.name === "Car")!;
    const plan = planGoal({ ...car, targetDate: "2027-11-12" }, today, null);
    expect(answer.calls.at(-1)!.name).toBe("required_saving");
    expect(answer.text).toContain(formatMAD(plan.requiredMonthly!));
    expect(unverifiedFigures(answer.text, answer.calls)).toEqual([]);
  });

  it("admits what it does not understand, and handles an empty ledger", () => {
    expect(ask("What is the meaning of life?").calls).toEqual([]);
    expect(ask("What is the meaning of life?").text).toContain("did not recognise");
    const empty = { ledger: EMPTY_LEDGER, today };
    expect(ask("Which goal should I prioritize?", empty).text).toContain("no active goals");
    expect(ask("Can I afford 8,000?", empty).text).toContain("complete month");
    expect(ask("Can I afford it?", empty).text).toContain("Tell me the price");
  });
});

describe("unverifiedFigures", () => {
  const calls = [{ name: "t", args: {}, result: { spent: "MAD 6,171.00", rate: "55.9%", months: 19, nested: [{ v: "MAD 1,234.56" }] } }];

  it("accepts figures that appear in a tool result, in any formatting", () => {
    expect(unverifiedFigures("You spent MAD 6,171 (6171.00), then 1,234.56 over 19 days in 2026.", calls)).toEqual([]);
  });

  it("flags figures that appear in no tool result", () => {
    expect(unverifiedFigures("You spent MAD 6,171 and saved MAD 9,999.", calls)).toEqual(["9,999"]);
    expect(unverifiedFigures("About 6200 dirhams.", calls)).toEqual(["6200"]);
  });
});

describe("askModel", () => {
  it("runs the tools the model asks for, feeds results back, and returns its answer with the calls", async () => {
    const { askModel } = await import("./model");
    const seen: unknown[][] = [];
    const replies = [
      { content: "", tool_calls: [{ name: "monthly_summary", arguments: {} }, { name: "no_such_tool", arguments: null }] },
      { content: "You spent what the summary says.", tool_calls: [] },
    ];
    const answer = await askModel("How much did I spend?", ctx, async (messages, tools) => {
      seen.push(structuredClone(messages));
      expect(tools).toHaveLength(TOOLS.length);
      return replies[seen.length - 1];
    });
    expect(answer.text).toBe("You spent what the summary says.");
    expect(answer.calls.map((c) => c.name)).toEqual(["monthly_summary", "no_such_tool"]);
    expect(answer.calls[1].result).toHaveProperty("error");
    // Round two received the tool results; the system prompt forbids arithmetic.
    const second = seen[1] as { role: string; content: string }[];
    expect(second.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool", "tool"]);
    expect(second[0].content).toContain("never calculate");
    expect(JSON.parse(second[3].content)).toHaveProperty("expenses");
  });

  it("stops after a bounded number of rounds", async () => {
    const { askModel } = await import("./model");
    let rounds = 0;
    const answer = await askModel("loop", ctx, async () => {
      rounds++;
      return { content: "", tool_calls: [{ name: "current_position", arguments: {} }] };
    });
    expect(rounds).toBe(5);
    expect(answer.text).toContain("without reaching an answer");
  });
});
