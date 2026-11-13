import { describe, expect, it } from "vitest";
import { accountBalance, effectOn, positionAt, type Account } from "./balances";
import { dirhams } from "./money";
import { upcomingOccurrences, type Schedule } from "./schedule";
import { summarizeMonth, type Transaction } from "./summary";

const current: Account = {
  id: "cur", name: "Current", kind: "current", openingBalance: dirhams(5000), openingDate: "2026-01-01",
};
const savings: Account = {
  id: "sav", name: "Savings", kind: "savings", openingBalance: dirhams(20_000), openingDate: "2026-01-01",
};
const cash: Account = {
  id: "cash", name: "Cash", kind: "cash", openingBalance: dirhams(300), openingDate: "2026-03-01",
};

const base = { categoryId: "x", isFixed: false } as const;
const txs: Transaction[] = [
  { ...base, id: "old", accountId: "cur", date: "2025-12-31", kind: "expense", amount: dirhams(999) },
  { ...base, id: "a", accountId: "cur", date: "2026-01-05", kind: "income", amount: dirhams(12_000) },
  { ...base, id: "b", accountId: "cur", date: "2026-01-10", kind: "expense", amount: dirhams(4000) },
  { ...base, id: "c", accountId: "cur", date: "2026-01-28", kind: "transfer", amount: dirhams(2000), transferAccountId: "sav", categoryId: null },
  { ...base, id: "d", accountId: "sav", date: "2026-02-15", kind: "transfer", amount: dirhams(500), transferAccountId: "cur", categoryId: null },
  { ...base, id: "e", accountId: "cash", date: "2026-03-02", kind: "expense", amount: dirhams(120) },
];

describe("accountBalance", () => {
  it("applies income, expenses and both sides of transfers", () => {
    expect(accountBalance(current, txs, "2026-01-31")).toBe(dirhams(11_000)); // 5000+12000-4000-2000
    expect(accountBalance(savings, txs, "2026-01-31")).toBe(dirhams(22_000));
    expect(accountBalance(current, txs, "2026-02-28")).toBe(dirhams(11_500));
    expect(accountBalance(savings, txs, "2026-02-28")).toBe(dirhams(21_500));
  });

  it("is inclusive of the as-of day and ignores later transactions", () => {
    expect(accountBalance(current, txs, "2026-01-04")).toBe(dirhams(5000));
    expect(accountBalance(current, txs, "2026-01-05")).toBe(dirhams(17_000));
  });

  it("ignores history before the opening date", () => {
    expect(accountBalance(current, txs, "2026-01-01")).toBe(dirhams(5000));
  });

  it("is unknown (null), not zero, before the account opens", () => {
    expect(accountBalance(cash, txs, "2026-02-28")).toBeNull();
    expect(accountBalance(cash, txs, "2026-03-02")).toBe(dirhams(180));
  });

  it("allows overdrafts", () => {
    const big: Transaction = { ...base, id: "z", accountId: "cur", date: "2026-01-02", kind: "expense", amount: dirhams(9000) };
    expect(accountBalance(current, [big], "2026-01-02")).toBe(dirhams(-4000));
  });

  it("rejects a transfer from an account to itself", () => {
    const loop: Transaction = { ...base, id: "l", accountId: "cur", date: "2026-01-02", kind: "transfer", amount: dirhams(1), transferAccountId: "cur" };
    expect(() => accountBalance(current, [loop], "2026-01-02")).toThrow(RangeError);
  });

  it("gives no effect on unrelated accounts", () => {
    expect(effectOn("sav", txs[1])).toBe(0);
  });
});

describe("positionAt", () => {
  it("separates available money from savings", () => {
    expect(positionAt([current, savings], txs, "2026-02-28")).toEqual({
      asOf: "2026-02-28",
      available: dirhams(11_500),
      savings: dirhams(21_500),
      netWorth: dirhams(33_000),
    });
  });

  it("counts cash as available", () => {
    expect(positionAt([current, savings, cash], txs, "2026-03-31")?.available).toBe(dirhams(11_680));
  });

  it("transfers never change net worth", () => {
    const before = positionAt([current, savings], txs, "2026-01-27")!;
    const after = positionAt([current, savings], txs, "2026-01-28")!;
    expect(after.netWorth).toBe(before.netWorth);
    expect(after.savings - before.savings).toBe(dirhams(2000));
  });

  it("is null when any account is not open yet, or there are none", () => {
    expect(positionAt([current, savings, cash], txs, "2026-02-28")).toBeNull();
    expect(positionAt([], txs, "2026-02-28")).toBeNull();
  });
});

describe("transfers in summaries", () => {
  it("are neither income nor expense", () => {
    const january = summarizeMonth(txs, "2026-01");
    expect(january.income).toBe(dirhams(12_000));
    expect(january.expenses).toBe(dirhams(4000));
    expect(january.net).toBe(dirhams(8000));
  });
});

describe("upcomingOccurrences", () => {
  const schedule = (id: string, startDate: string, amount: number, extra: Partial<Schedule> = {}): Schedule => ({
    id, rule: { frequency: "monthly", interval: 1, startDate }, accountId: "cur", kind: "expense",
    amount: dirhams(amount), categoryId: "bills", description: id, isFixed: true, ...extra,
  });

  it("merges schedules in date order and skips paused ones", () => {
    const upcoming = upcomingOccurrences(
      [schedule("rent", "2026-01-02", 3800), schedule("net", "2026-01-15", 299), schedule("gym", "2026-01-10", 250, { paused: true })],
      "2026-11-12",
      "2026-12-11",
    );
    expect(upcoming.map((u) => [u.scheduleId, u.date])).toEqual([
      ["net", "2026-11-15"],
      ["rent", "2026-12-02"],
    ]);
  });

  it("orders same-day items by amount, largest first", () => {
    const upcoming = upcomingOccurrences(
      [schedule("small", "2026-01-05", 50), schedule("large", "2026-01-05", 900)],
      "2026-02-01",
      "2026-02-28",
    );
    expect(upcoming.map((u) => u.scheduleId)).toEqual(["large", "small"]);
  });
});
