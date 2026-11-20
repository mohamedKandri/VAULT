/** Filtering, searching and sorting of the transaction list. Pure functions. */

import type { Ledger } from "../../data/ledger";
import { formatMAD, monthOf, type Transaction, type TransactionKind, type YearMonth } from "../../engine";

export type SortKey = "date" | "amount" | "description";

export interface TransactionQuery {
  /** Null = all time. */
  month: YearMonth | null;
  kind: TransactionKind | "all";
  accountId: string | "all";
  categoryId: string | "all";
  search: string;
  sort: SortKey;
  descending: boolean;
}

export interface TransactionRow extends Transaction {
  categoryName: string;
  accountName: string;
  /** Destination account name; transfers only. */
  transferAccountName: string | null;
}

/** Signed value for display and sorting: income positive, expense negative, transfer neutral magnitude. */
const signed = (tx: Transaction) => (tx.kind === "expense" ? -tx.amount : tx.amount);

export function queryTransactions(ledger: Ledger, query: TransactionQuery): TransactionRow[] {
  const categories = new Map(ledger.categories.map((c) => [c.id, c.name]));
  const accounts = new Map(ledger.accounts.map((a) => [a.id, a.name]));
  const needle = query.search.trim().toLocaleLowerCase();

  const rows = ledger.transactions
    .filter((tx) => {
      if (query.month && monthOf(tx.date) !== query.month) return false;
      if (query.kind !== "all" && tx.kind !== query.kind) return false;
      if (query.accountId !== "all" && tx.accountId !== query.accountId && tx.transferAccountId !== query.accountId) return false;
      if (query.categoryId !== "all" && tx.categoryId !== query.categoryId) return false;
      return true;
    })
    .map<TransactionRow>((tx) => ({
      ...tx,
      categoryName: tx.kind === "transfer" ? "Transfer" : (categories.get(tx.categoryId ?? "") ?? "Uncategorized"),
      accountName: accounts.get(tx.accountId) ?? "Unknown account",
      transferAccountName: tx.transferAccountId ? (accounts.get(tx.transferAccountId) ?? "Unknown account") : null,
    }))
    .filter((row) => {
      if (!needle) return true;
      const haystack = [
        row.description, row.notes, row.categoryName, row.accountName, row.transferAccountName, row.date,
        formatMAD(row.amount, { code: false }), formatMAD(row.amount, { code: false, decimals: "auto" }).replace(/,/g, ""),
      ];
      return haystack.some((text) => text?.toLocaleLowerCase().includes(needle));
    });

  const direction = query.descending ? -1 : 1;
  return rows.sort((a, b) => {
    let order = 0;
    if (query.sort === "amount") order = signed(a) - signed(b);
    else if (query.sort === "description") order = (a.description ?? "").localeCompare(b.description ?? "");
    else order = a.date.localeCompare(b.date);
    // Stable, deterministic tie-break: newest first, then id.
    return order * direction || b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
  });
}
