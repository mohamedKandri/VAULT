import { describe, expect, it } from "vitest";
import { dirhams, parseAmount } from "./money";
import {
  averageMonthlyExpenses,
  compareCategorySpending,
  summarizeMonth,
  type Transaction,
} from "./summary";

// Test fixtures only - never shipped as application data.
let nextId = 0;
const tx = (
  date: string,
  kind: Transaction["kind"],
  amount: string,
  categoryId: string,
  isFixed = false,
): Transaction => ({ id: `t${nextId++}`, date, kind, amount: parseAmount(amount), categoryId, isFixed });

const ledger: Transaction[] = [
  tx("2026-10-01", "income", "12000", "salary"),
  tx("2026-10-02", "expense", "3500", "rent", true),
  tx("2026-10-09", "expense", "500", "transport"),
  tx("2026-10-20", "expense", "1800.50", "food"),
  tx("2026-11-01", "income", "12000", "salary"),
  tx("2026-11-15", "income", "2500", "freelance"),
  tx("2026-11-02", "expense", "3500", "rent", true),
  tx("2026-11-03", "expense", "199.99", "subscriptions", true),
  tx("2026-11-07", "expense", "350", "transport"),
  tx("2026-11-21", "expense", "240", "transport"),
  tx("2026-11-11", "expense", "2100.01", "food"),
];

describe("summarizeMonth", () => {
  const november = summarizeMonth(ledger, "2026-11");

  it("totals income and expenses for the month only", () => {
    expect(november.income).toBe(dirhams(14_500));
    expect(november.expenses).toBe(dirhams(6390));
    expect(november.net).toBe(dirhams(8110));
    expect(november.transactionCount).toBe(7);
  });

  it("separates fixed from variable expenses", () => {
    expect(november.fixedExpenses).toBe(parseAmount("3699.99"));
    expect(november.variableExpenses).toBe(parseAmount("2690.01"));
    expect(november.fixedExpenses + november.variableExpenses).toBe(november.expenses);
  });

  it("computes the savings rate as net / income", () => {
    expect(november.savingsRateBps).toBe(5593); // 8110 / 14500 = 55.93%
  });

  it("ranks expense categories with their share", () => {
    expect(november.expensesByCategory.map((c) => c.categoryId)).toEqual([
      "rent", "food", "transport", "subscriptions",
    ]);
    expect(november.expensesByCategory[0]).toEqual({
      categoryId: "rent",
      total: dirhams(3500),
      shareBps: 5477, // 3500 / 6390
    });
  });

  it("reports an empty month as zeros with an undefined savings rate", () => {
    const empty = summarizeMonth(ledger, "2026-07");
    expect(empty).toMatchObject({
      income: 0, expenses: 0, net: 0, savingsRateBps: null, transactionCount: 0,
    });
    expect(empty.expensesByCategory).toEqual([]);
  });

  it("shows a negative savings rate when spending exceeds income", () => {
    const overspent = summarizeMonth(
      [tx("2026-09-01", "income", "1000", "salary"), tx("2026-09-02", "expense", "1250", "food")],
      "2026-09",
    );
    expect(overspent.net).toBe(dirhams(-250));
    expect(overspent.savingsRateBps).toBe(-2500);
  });

  it("rejects non-positive transaction amounts", () => {
    const bad = { ...tx("2026-09-01", "expense", "10", "food"), amount: dirhams(-10) };
    expect(() => summarizeMonth([bad], "2026-09")).toThrow(RangeError);
  });
});

describe("compareCategorySpending", () => {
  const changes = compareCategorySpending(ledger, "2026-11", "2026-10");
  const byId = Object.fromEntries(changes.map((c) => [c.categoryId, c]));

  it("computes the change behind '18% more on transportation'", () => {
    expect(byId.transport).toMatchObject({
      current: dirhams(590),
      previous: dirhams(500),
      delta: dirhams(90),
      changeBps: 1800,
    });
  });

  it("reports unchanged and new categories honestly", () => {
    expect(byId.rent.changeBps).toBe(0);
    expect(byId.subscriptions).toMatchObject({ previous: 0, changeBps: null });
  });

  it("orders by largest absolute change", () => {
    expect(changes.map((c) => c.categoryId)).toEqual(["food", "subscriptions", "transport", "rent"]);
  });
});

describe("averageMonthlyExpenses", () => {
  it("averages over the given months with exact rounding", () => {
    // October 5800.50 + November 6390.00 = 12190.50 / 2 = 6095.25
    expect(averageMonthlyExpenses(ledger, ["2026-10", "2026-11"])).toBe(parseAmount("6095.25"));
  });

  it("counts empty months as zero and returns null for no months", () => {
    expect(averageMonthlyExpenses(ledger, ["2026-09", "2026-10", "2026-11"])).toBe(parseAmount("4063.50"));
    expect(averageMonthlyExpenses(ledger, [])).toBeNull();
  });
});
