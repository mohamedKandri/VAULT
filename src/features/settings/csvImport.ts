/**
 * Turns CSV cells into validated transactions, without importing anything.
 * The result is a plan the user reviews: what will be added, what is skipped
 * as a duplicate, and which rows cannot be read and why.
 *
 * Expected columns (any order, extra columns ignored):
 *   date, type, amount            required
 *   category, account, to_account, description, notes, fixed   optional
 */

import type { TransactionInput } from "../../data/api";
import type { Ledger } from "../../data/ledger";
import { MoneyError, parseAmount, parseIsoDate, toIsoDate, type IsoDate, type TransactionKind } from "../../engine";

export interface ImportRow extends Omit<TransactionInput, "categoryId"> {
  /** An existing category id, or null when `newCategory` must be created first. */
  categoryId: string | null;
  newCategory: { name: string; kind: "income" | "expense" } | null;
}

export interface ImportPlan {
  rows: ImportRow[];
  newCategories: { name: string; kind: "income" | "expense" }[];
  duplicates: number;
  errors: { line: number; message: string }[];
}

const KINDS: Record<string, TransactionKind> = {
  income: "income", revenu: "income", credit: "income",
  expense: "expense", "dépense": "expense", depense: "expense", debit: "expense",
  transfer: "transfer", virement: "transfer", transfert: "transfer",
};

/** Accepts 2026-11-12, 12/11/2026 and 12-11-2026 (day first, as written in Morocco). */
export function readDate(text: string): IsoDate {
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const dmy = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  const parts = iso
    ? { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) }
    : dmy
      ? { year: Number(dmy[3]), month: Number(dmy[2]), day: Number(dmy[1]) }
      : null;
  if (!parts) throw new Error(`"${text}" is not a date (use 2026-11-12 or 12/11/2026)`);
  return toIsoDate(parts);
}

const key = (r: { date: string; kind: string; amount: number; accountId: string; description: string }) =>
  [r.date, r.kind, r.amount, r.accountId, r.description.trim().toLowerCase()].join("|");

export function planImport(headers: string[], rows: string[][], ledger: Ledger): ImportPlan {
  const column = (name: string) => headers.indexOf(name);
  const required = ["date", "type", "amount"].filter((name) => column(name) === -1);
  if (required.length > 0) {
    return { rows: [], newCategories: [], duplicates: 0, errors: [{ line: 1, message: `Missing column: ${required.join(", ")}. The first row must name the columns.` }] };
  }
  const accounts = ledger.accounts.filter((a) => !a.archived);
  const accountByName = new Map(ledger.accounts.map((a) => [a.name.trim().toLowerCase(), a.id]));
  const categoryByKey = new Map(ledger.categories.map((c) => [`${c.kind}|${c.name.trim().toLowerCase()}`, c]));
  const existing = new Set(ledger.transactions.map((t) => key({ ...t, description: t.description ?? "" })));

  const plan: ImportPlan = { rows: [], newCategories: [], duplicates: 0, errors: [] };
  const seenNew = new Set<string>();

  rows.forEach((cells, index) => {
    const line = index + 2; // 1-based, after the header row
    const cell = (name: string) => (column(name) === -1 ? "" : (cells[column(name)] ?? "").trim());
    try {
      const kind = KINDS[cell("type").toLowerCase()];
      if (!kind) throw new Error(`"${cell("type")}" is not a type (use income, expense or transfer)`);
      const date = readDate(cell("date"));
      parseIsoDate(date);
      let amount;
      try {
        amount = parseAmount(cell("amount"));
      } catch (error) {
        if (error instanceof MoneyError) throw new Error(`"${cell("amount")}" is not an amount`);
        throw error;
      }
      // Bank exports often sign expenses negative; the type column already gives the direction.
      if (amount < 0) amount = parseAmount(cell("amount").replace("-", ""));
      if (amount === 0) throw new Error("the amount is zero");

      const account = (name: string, label: string) => {
        if (name === "") {
          if (accounts.length === 1) return accounts[0].id;
          throw new Error(`the ${label} column is empty and there is more than one account`);
        }
        const id = accountByName.get(name.toLowerCase());
        if (!id) throw new Error(`there is no account named "${name}"`);
        return id;
      };
      const accountId = account(cell("account"), "account");

      let transferAccountId: string | null = null;
      let categoryId: string | null = null;
      let newCategory: ImportRow["newCategory"] = null;
      if (kind === "transfer") {
        if (cell("to_account") === "") throw new Error("a transfer needs a to_account");
        transferAccountId = account(cell("to_account"), "to_account");
        if (transferAccountId === accountId) throw new Error("a transfer needs two different accounts");
      } else {
        const name = cell("category") || (kind === "income" ? "Additional income" : "Other");
        const found = categoryByKey.get(`${kind}|${name.toLowerCase()}`);
        if (found) categoryId = found.id;
        else {
          newCategory = { name, kind };
          if (!seenNew.has(`${kind}|${name.toLowerCase()}`)) {
            seenNew.add(`${kind}|${name.toLowerCase()}`);
            plan.newCategories.push(newCategory);
          }
        }
      }

      const fixedCell = cell("fixed").toLowerCase();
      const row: ImportRow = {
        accountId, date, kind, amount, categoryId, newCategory, transferAccountId,
        description: cell("description").slice(0, 200),
        notes: cell("notes").slice(0, 2000),
        isFixed: kind === "expense" && (fixedCell === "" ? (categoryId ? !!ledger.categories.find((c) => c.id === categoryId)?.isFixedDefault : false) : ["yes", "true", "1", "oui"].includes(fixedCell)),
      };
      const rowKey = key(row);
      if (existing.has(rowKey)) {
        plan.duplicates++;
        return;
      }
      existing.add(rowKey); // also catches the same line twice within the file
      plan.rows.push(row);
    } catch (error) {
      plan.errors.push({ line, message: error instanceof Error ? error.message : String(error) });
    }
  });
  return plan;
}

/** Replace "new category" placeholders with real ids once the categories exist. */
export function resolveImport(rows: ImportRow[], ledger: Ledger): TransactionInput[] {
  const categoryByKey = new Map(ledger.categories.map((c) => [`${c.kind}|${c.name.trim().toLowerCase()}`, c.id]));
  return rows.map(({ newCategory, ...row }) => ({
    ...row,
    categoryId: newCategory ? (categoryByKey.get(`${newCategory.kind}|${newCategory.name.toLowerCase()}`) ?? null) : row.categoryId,
  }));
}
