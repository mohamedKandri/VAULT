import { describe, expect, it } from "vitest";
import { buildDemoLedger } from "../../data/demoLedger";
import { EMPTY_LEDGER } from "../../data/ledger";
import { accountBalance, dirhams, positionAt, sum } from "../../engine";
import { buildDashboard } from "./model";

const TODAY = "2026-11-12";
const ledger = buildDemoLedger(TODAY);
const model = buildDashboard(ledger, TODAY);

describe("demo ledger", () => {
  it("is deterministic and never records the future", () => {
    expect(buildDemoLedger(TODAY)).toEqual(ledger);
    expect(ledger.transactions.every((tx) => tx.date <= TODAY)).toBe(true);
    expect(ledger.transactions.every((tx) => tx.amount > 0)).toBe(true);
  });

  it("keeps the current account solvent throughout", () => {
    const current = ledger.accounts[0];
    for (const tx of ledger.transactions) {
      expect(accountBalance(current, ledger.transactions, tx.date)!).toBeGreaterThan(0);
    }
  });
});

describe("buildDashboard", () => {
  it("covers twelve months ending with a partial current month", () => {
    expect(model.months).toHaveLength(12);
    expect(model.months[0].month).toBe("2025-12");
    expect(model.months.at(-1)).toMatchObject({ month: "2026-11", partial: true });
    expect(model.months.slice(0, -1).every((m) => !m.partial)).toBe(true);
  });

  it("reports the position from account balances", () => {
    expect(model.position).toEqual(positionAt(ledger.accounts, ledger.transactions, TODAY));
    expect(model.months.at(-1)!.position).toEqual(model.position);
    // Eleven completed monthly transfers of MAD 4,000 on top of the opening MAD 30,000.
    expect(model.position!.savings).toBe(dirhams(30_000 + 11 * 4000));
  });

  it("keeps category rows consistent with total expenses", () => {
    expect(sum(model.categories.map((c) => c.total))).toBe(model.current.expenses);
    expect(model.categories[0].id).toBe("rent");
  });

  it("net worth changes only by income minus expenses", () => {
    for (let i = 1; i < model.months.length; i++) {
      const change = model.months[i].position!.netWorth - model.months[i - 1].position!.netWorth;
      expect(change).toBe(model.months[i].net);
    }
  });

  it("compares the current month with the same days of the previous month", () => {
    expect(model.samePeriodEnd).toBe("2026-10-12");
    // Oct 1-12: salary only (freelance arrives on the 18th).
    expect(model.samePeriodLastMonth!.income).toBe(dirhams(14_000));
  });

  it("lists upcoming scheduled items for the next 30 days, soonest first", () => {
    expect(model.upcoming.map((u) => [u.description, u.date])).toEqual([
      ["Fibre internet", "2026-11-15"],
      ["Monthly savings", "2026-11-28"],
      ["Monthly salary", "2026-12-01"],
      ["Apartment rent", "2026-12-02"],
      ["Streaming, cloud, gym", "2026-12-05"],
      ["Annual insurance", "2026-12-10"],
    ]);
    expect(model.upcomingExpenseTotal).toBe(dirhams(299 + 3800 + 249 + 2650));
  });
});

describe("empty ledger", () => {
  const empty = buildDashboard(EMPTY_LEDGER, TODAY);

  it("reports no data rather than zeros dressed up as facts", () => {
    expect(empty.hasData).toBe(false);
    expect(empty.position).toBeNull();
    expect(empty.samePeriodLastMonth).toBeNull();
    expect(empty.months).toHaveLength(1);
    expect(empty.current.savingsRateBps).toBeNull();
    expect(empty.upcoming).toEqual([]);
  });
});
