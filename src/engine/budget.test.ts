import { describe, expect, it } from "vitest";
import type { Account } from "./balances";
import { financialHealth, safeToSpend } from "./budget";
import { dirhams, sum } from "./money";
import { describeFrequency, dueOccurrences, type Schedule } from "./schedule";
import type { Transaction } from "./summary";

const accounts: Account[] = [
  { id: "cur", name: "Current", kind: "current", openingBalance: dirhams(5000), openingDate: "2026-08-01" },
  { id: "sav", name: "Savings", kind: "savings", openingBalance: dirhams(20_000), openingDate: "2026-08-01" },
];
let n = 0;
const tx = (date: string, kind: Transaction["kind"], amount: number, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId: "cur", date, kind, amount: dirhams(amount), categoryId: kind === "transfer" ? null : "c", isFixed: false, ...extra,
});
const monthly = (id: string, day: string, kind: Schedule["kind"], amount: number, extra: Partial<Schedule> = {}): Schedule => ({
  id, rule: { frequency: "monthly", interval: 1, startDate: `2026-08-${day}` }, accountId: "cur", kind,
  amount: dirhams(amount), categoryId: kind === "transfer" ? null : "c", description: id, isFixed: true, ...extra,
});

const schedules = [
  monthly("salary", "01", "income", 14_000),
  monthly("rent", "02", "expense", 3800),
  monthly("internet", "15", "expense", 300),
  monthly("save", "28", "transfer", 4000, { transferAccountId: "sav" }),
];
// November so far (today = 12 Nov): salary and rent posted, some variable spending.
const november = [
  tx("2026-11-01", "income", 14_000),
  tx("2026-11-02", "expense", 3800, { isFixed: true }),
  tx("2026-11-04", "expense", 900),
  tx("2026-11-09", "expense", 600),
];

describe("safeToSpend", () => {
  const budget = safeToSpend(accounts, november, schedules, "2026-11-12");

  it("matches the hand calculation", () => {
    // 14000 income - (3800 rent + 300 internet still due) - 4000 savings still due = 5900 limit
    expect(budget.expectedIncome).toBe(dirhams(14_000));
    expect(budget.committed).toBe(dirhams(4100));
    expect(budget.savings).toBe(dirhams(4000));
    expect(budget.spendingLimit).toBe(dirhams(5900));
    expect(budget.variableSpent).toBe(dirhams(1500));
    expect(budget.remaining).toBe(dirhams(4400));
  });

  it("spreads the remainder over the days left, today included", () => {
    expect(budget.daysLeft).toBe(19); // 12..30 November
    expect(budget.perDay).toBe(23_158); // 4400 / 19 = 231.578... -> 231.58
  });

  it("explains itself: the lines sum to the remaining amount", () => {
    expect(sum(budget.lines.map((l) => l.amount))).toBe(budget.remaining);
    expect(budget.lines.find((l) => l.label === "Expenses still scheduled")?.amount).toBe(dirhams(-300));
  });

  it("does not double count once a scheduled item has been recorded", () => {
    const later = [...november, tx("2026-11-15", "expense", 300, { isFixed: true })];
    const after = safeToSpend(accounts, later, schedules, "2026-11-16");
    expect(after.committed).toBe(dirhams(4100));
    expect(after.remaining).toBe(dirhams(4400));
  });

  it("counts income not yet received but scheduled", () => {
    const withBonus = [...schedules, monthly("bonus", "25", "income", 2000)];
    expect(safeToSpend(accounts, november, withBonus, "2026-11-12").spendingLimit).toBe(dirhams(7900));
  });

  it("treats money taken back out of savings as reducing savings", () => {
    const withdrawal = [...november, tx("2026-11-10", "transfer", 1000, { accountId: "sav", transferAccountId: "cur" })];
    const b = safeToSpend(accounts, withdrawal, schedules, "2026-11-12");
    expect(b.savings).toBe(dirhams(3000));
    expect(b.spendingLimit).toBe(dirhams(6900));
  });

  it("reports overspending as negative with no daily allowance", () => {
    const over = safeToSpend(accounts, [...november, tx("2026-11-11", "expense", 5000)], schedules, "2026-11-12");
    expect(over.remaining).toBe(dirhams(-600));
    expect(over.perDay).toBeNull();
  });

  it("handles the last day of the month and an empty ledger", () => {
    expect(safeToSpend(accounts, november, schedules, "2026-11-30").daysLeft).toBe(1);
    const empty = safeToSpend([], [], [], "2026-11-12");
    expect(empty).toMatchObject({ spendingLimit: 0, remaining: 0, perDay: null });
  });
});

describe("financialHealth", () => {
  const history = [
    tx("2026-08-01", "income", 14_000), tx("2026-08-05", "expense", 4000, { isFixed: true }), tx("2026-08-20", "expense", 5000),
    tx("2026-09-01", "income", 14_000), tx("2026-09-05", "expense", 4000, { isFixed: true }), tx("2026-09-20", "expense", 6000),
    tx("2026-10-01", "income", 16_000), tx("2026-10-05", "expense", 4000, { isFixed: true }), tx("2026-10-20", "expense", 4000),
    ...november,
  ];
  const health = financialHealth(accounts, history, "2026-11-12");

  it("averages the last three complete months only", () => {
    expect(health.monthsUsed).toBe(3);
    expect(health.averageIncome).toBe(1_466_667); // 44000 / 3
    expect(health.averageExpenses).toBe(dirhams(9000)); // 27000 / 3
  });

  it("computes cover, fixed share and savings rate", () => {
    // Net worth 12 Nov: 25000 + (44000 - 27000) + (14000 - 5300) = 50700; / 9000 = 5.63 months
    expect(health.coverTenths).toBe(56);
    expect(health.fixedShareBps).toBe(2727); // 12000 / 44000
    expect(health.savingsRateBps).toBe(3864); // 17000 / 44000
  });

  it("uses fewer months when history is short, and none when there is no complete month", () => {
    const young: Account[] = accounts.map((a) => ({ ...a, openingDate: "2026-10-01" }));
    expect(financialHealth(young, history.filter((t) => t.date >= "2026-10-01"), "2026-11-12").monthsUsed).toBe(1);
    const brandNew: Account[] = accounts.map((a) => ({ ...a, openingDate: "2026-11-05" }));
    expect(financialHealth(brandNew, november.filter((t) => t.date >= "2026-11-05"), "2026-11-12")).toMatchObject({
      monthsUsed: 0, coverTenths: null, savingsRateBps: null,
    });
  });
});

describe("dueOccurrences", () => {
  it("lists everything from the start for a new schedule", () => {
    expect(dueOccurrences([monthly("rent", "02", "expense", 3800)], "2026-11-12").map((d) => d.date)).toEqual([
      "2026-08-02", "2026-09-02", "2026-10-02", "2026-11-02",
    ]);
  });

  it("resumes after postedThrough and skips paused or future schedules", () => {
    const posted = monthly("rent", "02", "expense", 3800, { postedThrough: "2026-10-02" });
    expect(dueOccurrences([posted], "2026-11-12")).toEqual([{ scheduleId: "rent", date: "2026-11-02" }]);
    expect(dueOccurrences([{ ...posted, postedThrough: "2026-11-12" }], "2026-11-12")).toEqual([]);
    expect(dueOccurrences([{ ...posted, paused: true }], "2026-11-12")).toEqual([]);
    const future: Schedule = { ...posted, postedThrough: null, rule: { ...posted.rule, startDate: "2027-01-01" } };
    expect(dueOccurrences([future], "2026-11-12")).toEqual([]);
  });

  it("describes frequencies", () => {
    const d = (frequency: "weekly" | "monthly" | "yearly", interval: number) =>
      describeFrequency({ frequency, interval, startDate: "2026-01-01" });
    expect([d("weekly", 1), d("weekly", 2), d("monthly", 1), d("monthly", 3), d("monthly", 6), d("yearly", 1)]).toEqual([
      "Weekly", "Every 2 weeks", "Monthly", "Quarterly", "Every 6 months", "Yearly",
    ]);
  });
});
