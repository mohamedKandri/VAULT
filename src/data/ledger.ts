import type { Account, Schedule, Transaction } from "../engine";

export interface LedgerAccount extends Account {
  /** Hidden from pickers; its history still counts in balances. */
  archived: boolean;
}

export interface Category {
  id: string;
  name: string;
  kind: "income" | "expense";
  /** New expenses in this category start as fixed commitments. */
  isFixedDefault?: boolean;
  archived?: boolean;
}

/** Everything the engine needs to compute the user's position. */
export interface Ledger {
  accounts: LedgerAccount[];
  categories: Category[];
  transactions: Transaction[];
  schedules: Schedule[];
}

export const EMPTY_LEDGER: Ledger = { accounts: [], categories: [], transactions: [], schedules: [] };
