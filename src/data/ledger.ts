import type { Account, Schedule, Transaction } from "../engine";

export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense";
}

/** Everything the engine needs to compute the user's position. */
export interface Ledger {
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
  schedules: Schedule[];
}

export const EMPTY_LEDGER: Ledger = { accounts: [], categories: [], transactions: [], schedules: [] };
