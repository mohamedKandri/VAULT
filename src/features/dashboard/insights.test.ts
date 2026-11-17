import { describe, expect, it } from "vitest";
import type { Ledger } from "../../data/ledger";
import { EMPTY_LEDGER } from "../../data/ledger";
import { dirhams, type Transaction } from "../../engine";
import { buildInsights } from "./insights";

let n = 0;
const tx = (date: string, kind: Transaction["kind"], amount: number, categoryId: string | null, extra: Partial<Transaction> = {}): Transaction => ({
  id: `t${n++}`, accountId: "cur", date, kind, amount: dirhams(amount), categoryId, isFixed: false, ...extra,
});

const base: Ledger = {
  accounts: [
    { id: "cur", name: "Current", kind: "current", openingBalance: dirhams(5000), openingDate: "2026-08-01", archived: false },
    { id: "sav", name: "Savings", kind: "savings", openingBalance: dirhams(20_000), openingDate: "2026-08-01", archived: false },
  ],
  categories: [
    { id: "salary", name: "Salary", kind: "income" },
    { id: "transport", name: "Transportation", kind: "expense" },
    { id: "food", name: "Food", kind: "expense" },
    { id: "rent", name: "Rent", kind: "expense" },
  ],
  transactions: [
    tx("2026-10-01", "income", 14_000, "salary"),
    tx("2026-10-02", "expense", 3800, "rent", { isFixed: true }),
    tx("2026-10-05", "expense", 500, "transport"),
    tx("2026-10-08", "expense", 1000, "food"),
    tx("2026-10-20", "expense", 900, "transport"), // after 12 Oct: not part of the comparison
    tx("2026-11-01", "income", 14_000, "salary"),
    tx("2026-11-02", "expense", 3800, "rent", { isFixed: true }),
    tx("2026-11-06", "expense", 590, "transport"),
    tx("2026-11-09", "expense", 700, "food"),
  ],
  schedules: [],
  goals: [],
};
const today = "2026-11-12";
const byId = (ledger: Ledger) => Object.fromEntries(buildInsights(ledger, today).map((i) => [i.id, i]));

describe("buildInsights", () => {
  it("says nothing without records", () => {
    expect(buildInsights(EMPTY_LEDGER, today)).toEqual([]);
  });

  it("reports what is left to spend, with its calculation", () => {
    const { budget } = byId(base);
    // 14,000 income - 3,800 rent - 1,290 variable = 8,910
    expect(budget.tone).toBe("neutral");
    expect(budget.text).toContain("MAD 8,910 available for the rest of November 2026");
    expect(budget.basis.at(-1)).toBe("Result: MAD 8,910.00");
    expect(budget.basis).not.toContain("Income still scheduled: 0.00"); // zero lines are left out
  });

  it("flags overspending", () => {
    const over = { ...base, transactions: [...base.transactions, tx("2026-11-10", "expense", 9500, "food")] };
    const { budget } = byId(over);
    expect(budget.tone).toBe("caution");
    expect(budget.text).toContain("You are MAD 590 over");
  });

  it("compares categories with the same days of last month", () => {
    const insights = byId(base);
    // Transportation: 590 now vs 500 on 1-12 Oct = +18%, +90: under the MAD 100 floor -> not shown
    expect(insights["category-transport"]).toBeUndefined();
    // Food: 700 vs 1,000 = -30%, -300 -> shown as positive
    expect(insights["category-food"]).toMatchObject({ tone: "positive" });
    expect(insights["category-food"].text).toBe("You spent 30% less on food than in the same days of October 2026: MAD 700 against MAD 1,000.");
    expect(insights["category-food"].basis[1]).toBe("Food, 1–12 Oct: MAD 1,000.00");
  });

  it("reproduces the brief's example: 18% more on transportation", () => {
    const busier = {
      ...base,
      transactions: base.transactions.map((t) => (t.categoryId === "transport" && t.date === "2026-11-06" ? { ...t, amount: dirhams(1180) } : t))
        .map((t) => (t.categoryId === "transport" && t.date === "2026-10-05" ? { ...t, amount: dirhams(1000) } : t)),
    };
    const insight = byId(busier)["category-transport"];
    expect(insight.tone).toBe("caution");
    expect(insight.text).toBe("You spent 18% more on transportation than in the same days of October 2026: MAD 1,180 against MAD 1,000.");
  });

  it("never compares against a category that had no spending", () => {
    const fresh = { ...base, transactions: [...base.transactions, tx("2026-11-11", "expense", 2000, "transport", { categoryId: "gifts" })] };
    expect(Object.keys(byId(fresh)).some((k) => k.includes("gifts"))).toBe(false);
  });

  it("explains the date of the most important goal, and when it is late", () => {
    const withGoal: Ledger = {
      ...base,
      goals: [
        { id: "car", name: "Car", targetPrice: dirhams(65_000), savedAmount: dirhams(0), targetDate: null, monthlyContribution: dirhams(2000), priority: 2, status: "active", costs: [] },
        {
          id: "moto", name: "Motorcycle", targetPrice: dirhams(25_000), savedAmount: dirhams(9500), targetDate: "2027-05-15",
          monthlyContribution: dirhams(2000), priority: 1, status: "active", costs: [{ label: "Registration", amount: dirhams(1200), frequency: "once" }],
        },
      ],
    };
    const { goal } = byId(withGoal);
    // 26,200 - 9,500 = 16,700 / 2,000 = 8.35 -> 9 months
    expect(goal.text).toBe("At MAD 2,000 a month, the Motorcycle is covered in about 9 months (August 2027). That is after the May 2027 you set; it would take MAD 2,783.34 a month.");
    expect(goal.tone).toBe("caution");
    expect(goal.basis[0]).toBe("Needed on purchase day: MAD 25,000.00 price + MAD 1,200.00 one-off costs = MAD 26,200.00");
  });

  it("skips funded goals and explains a goal with no monthly saving", () => {
    const goals: Ledger["goals"] = [
      { id: "a", name: "Phone", targetPrice: dirhams(3000), savedAmount: dirhams(3000), targetDate: null, monthlyContribution: dirhams(0), priority: 1, status: "active", costs: [] },
      { id: "b", name: "Laptop", targetPrice: dirhams(9000), savedAmount: dirhams(1000), targetDate: null, monthlyContribution: dirhams(0), priority: 2, status: "active", costs: [] },
    ];
    const { goal } = byId({ ...base, goals });
    expect(goal.text).toBe("No monthly saving is set for the Laptop, so it has no date. MAD 8,000 is still needed.");
  });

  it("flags a thin cushion only", () => {
    expect(byId(base).cover).toBeUndefined();
    const thin: Ledger = { ...base, accounts: base.accounts.map((a) => ({ ...a, openingBalance: dirhams(0) })) };
    // Extra 10,000 in October: net worth -2,200 + 8,910 = 6,710; average expenses 16,200 / 3 = 5,400 -> 1.2 months
    const heavy: Ledger = { ...thin, transactions: [...thin.transactions, tx("2026-10-25", "expense", 10_000, "food")] };
    expect(byId(heavy).cover).toMatchObject({ tone: "caution", text: "Your balances cover about 1.2 months of expenses." });
    // Net worth below zero says so rather than printing a negative number of months.
    const underwater: Ledger = { ...thin, transactions: [...thin.transactions, tx("2026-10-25", "expense", 22_000, "food")] };
    expect(byId(underwater).cover?.text).toBe("Your balances do not cover a single month of expenses.");
  });
});
