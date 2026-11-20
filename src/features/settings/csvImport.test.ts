import { describe, expect, it } from "vitest";
import type { Ledger } from "../../data/ledger";
import { dirhams, parseAmount } from "../../engine";
import { planImport, readDate, resolveImport } from "./csvImport";

const ledger: Ledger = {
  accounts: [
    { id: "cur", name: "Current", kind: "current", openingBalance: dirhams(0), openingDate: "2026-01-01", archived: false },
    { id: "sav", name: "Savings", kind: "savings", openingBalance: dirhams(0), openingDate: "2026-01-01", archived: false },
  ],
  categories: [
    { id: "food", name: "Food", kind: "expense" },
    { id: "rent", name: "Rent", kind: "expense", isFixedDefault: true },
    { id: "other", name: "Other", kind: "expense" },
    { id: "salary", name: "Salary", kind: "income" },
  ],
  transactions: [
    { id: "t1", accountId: "cur", date: "2026-11-04", kind: "expense", amount: parseAmount("320.50"), categoryId: "food", isFixed: false, description: "Marjane" },
  ],
  schedules: [],
  goals: [],
};
const headers = ["date", "type", "amount", "category", "account", "to_account", "description", "notes", "fixed"];
const plan = (rows: string[][], h = headers, l = ledger) => planImport(h, rows, l);

describe("readDate", () => {
  it("accepts ISO and day-first dates, and rejects impossible ones", () => {
    expect(readDate("2026-11-12")).toBe("2026-11-12");
    expect(readDate("12/11/2026")).toBe("2026-11-12");
    expect(readDate("2.3.2026")).toBe("2026-03-02");
    expect(() => readDate("31/02/2026")).toThrow();
    expect(() => readDate("Nov 12")).toThrow();
  });
});

describe("planImport", () => {
  it("reads valid rows of each type", () => {
    const p = plan([
      ["2026-11-01", "income", "14,000", "Salary", "Current", "", "November salary", "", ""],
      ["02/11/2026", "Expense", "3 800,00", "rent", "current", "", "Rent", "paid by transfer", ""],
      ["2026-11-28", "transfer", "4000", "", "Current", "Savings", "To savings", "", ""],
    ]);
    expect(p.errors).toEqual([]);
    expect(p.rows).toHaveLength(3);
    expect(p.rows[0]).toMatchObject({ kind: "income", amount: dirhams(14_000), categoryId: "salary", accountId: "cur" });
    expect(p.rows[1]).toMatchObject({ date: "2026-11-02", amount: dirhams(3800), categoryId: "rent", isFixed: true, notes: "paid by transfer" });
    expect(p.rows[2]).toMatchObject({ kind: "transfer", categoryId: null, transferAccountId: "sav" });
  });

  it("skips duplicates of existing records and repeats within the file", () => {
    const row = ["2026-11-04", "expense", "320.50", "Food", "Current", "", "marjane", "", ""];
    const fresh = ["2026-11-05", "expense", "45", "Food", "Current", "", "Bakery", "", ""];
    const p = plan([row, fresh, fresh]);
    expect(p.rows).toHaveLength(1);
    expect(p.duplicates).toBe(2);
  });

  it("reports unreadable rows with their line number and keeps the good ones", () => {
    const p = plan([
      ["2026-11-01", "income", "14000", "Salary", "Current", "", "ok", "", ""],
      ["2026-13-01", "income", "100", "Salary", "Current", "", "", "", ""],
      ["2026-11-02", "gift", "100", "", "Current", "", "", "", ""],
      ["2026-11-03", "expense", "12.3456", "Food", "Current", "", "", "", ""],
      ["2026-11-04", "expense", "50", "Food", "Brokerage", "", "", "", ""],
      ["2026-11-05", "transfer", "50", "", "Current", "Current", "", "", ""],
      ["2026-11-06", "expense", "0", "Food", "Current", "", "", "", ""],
    ]);
    expect(p.rows).toHaveLength(1);
    expect(p.errors.map((e) => e.line)).toEqual([3, 4, 5, 6, 7, 8]);
    expect(p.errors[3].message).toContain("Brokerage");
  });

  it("plans new categories once each and resolves them after creation", () => {
    const p = plan([
      ["2026-11-01", "expense", "200", "Health", "Current", "", "Pharmacy", "", ""],
      ["2026-11-02", "expense", "90", "health", "Current", "", "Doctor", "", ""],
      ["2026-11-03", "expense", "15", "", "Current", "", "No category", "", ""],
    ]);
    expect(p.newCategories).toEqual([{ name: "Health", kind: "expense" }]);
    expect(p.rows[2].categoryId).toBe("other"); // blank category falls back to Other
    const after: Ledger = { ...ledger, categories: [...ledger.categories, { id: "health", name: "Health", kind: "expense" }] };
    const inputs = resolveImport(p.rows, after);
    expect(inputs.map((i) => i.categoryId)).toEqual(["health", "health", "other"]);
    expect("newCategory" in inputs[0]).toBe(false);
  });

  it("treats a signed bank amount as its magnitude and honours the fixed column", () => {
    const p = plan([["2026-11-01", "debit", "-249,00", "Food", "Current", "", "Gym", "", "oui"]]);
    expect(p.rows[0]).toMatchObject({ kind: "expense", amount: dirhams(249), isFixed: true });
  });

  it("needs the account column when there are several accounts, but not with one", () => {
    const minimal = ["date", "type", "amount"];
    expect(plan([["2026-11-01", "expense", "10"]], minimal).errors[0].message).toContain("more than one account");
    const single: Ledger = { ...ledger, accounts: [ledger.accounts[0]] };
    expect(plan([["2026-11-01", "expense", "10"]], minimal, single).rows).toHaveLength(1);
  });

  it("explains a missing required column", () => {
    const p = plan([["x"]], ["date", "montant"]);
    expect(p.rows).toEqual([]);
    expect(p.errors[0].message).toContain("type, amount");
  });
});
