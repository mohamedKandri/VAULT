import { describe, expect, it } from "vitest";
import type { Ledger } from "../../data/ledger";
import { dirhams, parseAmount, type Transaction } from "../../engine";
import { queryTransactions, type TransactionQuery } from "./filter";

const tx = (id: string, date: string, kind: Transaction["kind"], amount: string, extra: Partial<Transaction> = {}): Transaction => ({
  id, date, kind, amount: parseAmount(amount), accountId: "cur", categoryId: kind === "transfer" ? null : "food", isFixed: false, ...extra,
});

const ledger: Ledger = {
  accounts: [
    { id: "cur", name: "Current", kind: "current", openingBalance: dirhams(0), openingDate: "2026-01-01", archived: false },
    { id: "sav", name: "Savings", kind: "savings", openingBalance: dirhams(0), openingDate: "2026-01-01", archived: false },
  ],
  categories: [
    { id: "food", name: "Food", kind: "expense" },
    { id: "salary", name: "Salary", kind: "income" },
  ],
  transactions: [
    tx("a", "2026-11-01", "income", "14000", { categoryId: "salary", description: "November salary" }),
    tx("b", "2026-11-04", "expense", "320.50", { description: "Marjane", notes: "weekly groceries" }),
    tx("c", "2026-11-09", "expense", "85", { description: "Café" }),
    tx("d", "2026-11-28", "transfer", "4000", { transferAccountId: "sav", description: "Monthly savings" }),
    tx("e", "2026-10-15", "expense", "1500", { description: "Atlas dinner" }),
  ],
  schedules: [],
};

const base: TransactionQuery = {
  month: "2026-11", kind: "all", accountId: "all", categoryId: "all", search: "", sort: "date", descending: true,
};
const ids = (query: Partial<TransactionQuery>) => queryTransactions(ledger, { ...base, ...query }).map((r) => r.id);

describe("queryTransactions", () => {
  it("filters by month, newest first by default", () => {
    expect(ids({})).toEqual(["d", "c", "b", "a"]);
    expect(ids({ month: "2026-10" })).toEqual(["e"]);
    expect(ids({ month: null })).toEqual(["d", "c", "b", "a", "e"]);
  });

  it("filters by kind, account and category", () => {
    expect(ids({ kind: "expense" })).toEqual(["c", "b"]);
    expect(ids({ kind: "transfer" })).toEqual(["d"]);
    expect(ids({ accountId: "sav" })).toEqual(["d"]); // transfers match on either side
    expect(ids({ categoryId: "salary" })).toEqual(["a"]);
  });

  it("searches description, notes, category, account and amount", () => {
    expect(ids({ search: "marjane" })).toEqual(["b"]);
    expect(ids({ search: "GROCERIES" })).toEqual(["b"]);
    expect(ids({ search: "salary" })).toEqual(["a"]);
    expect(ids({ search: "savings" })).toEqual(["d"]);
    expect(ids({ search: "320.50" })).toEqual(["b"]);
    expect(ids({ search: "14000" })).toEqual(["a"]);
    expect(ids({ search: "14,000" })).toEqual(["a"]);
    expect(ids({ search: "nothing like this" })).toEqual([]);
  });

  it("sorts by signed amount and by description", () => {
    expect(ids({ sort: "amount", descending: true })).toEqual(["a", "d", "c", "b"]);
    expect(ids({ sort: "amount", descending: false })).toEqual(["b", "c", "d", "a"]);
    expect(ids({ sort: "description", descending: false })).toEqual(["c", "b", "d", "a"]);
    expect(ids({ sort: "date", descending: false })).toEqual(["a", "b", "c", "d"]);
  });

  it("resolves names for display", () => {
    const [transfer] = queryTransactions(ledger, { ...base, kind: "transfer" });
    expect(transfer).toMatchObject({ categoryName: "Transfer", accountName: "Current", transferAccountName: "Savings" });
  });
});
