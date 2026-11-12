/**
 * Account balances.
 *
 * VAULT has no bank connection: a balance is the account's opening balance
 * plus the effect of every transaction recorded since. It is only as accurate
 * as the records, which is why checkpoints (Phase 3) let the user reconcile.
 *
 *   available = current + cash accounts   (money that can be spent)
 *   savings   = savings accounts
 *   net worth = available + savings
 */

import type { IsoDate } from "./dates";
import { ZERO, add, negate, type Centimes } from "./money";
import type { Transaction } from "./summary";

export type AccountKind = "current" | "savings" | "cash";

export interface Account {
  id: string;
  name: string;
  kind: AccountKind;
  /** Balance at the start of `openingDate`. May be negative (overdraft). */
  openingBalance: Centimes;
  /** Transactions dated before this are history and do not affect the balance. */
  openingDate: IsoDate;
}

/** Signed effect of a transaction on one account. */
export function effectOn(accountId: string, tx: Transaction): Centimes {
  let effect = ZERO;
  if (tx.accountId === accountId) {
    effect = add(effect, tx.kind === "income" ? tx.amount : negate(tx.amount));
  }
  if (tx.kind === "transfer" && tx.transferAccountId === accountId) {
    effect = add(effect, tx.amount);
  }
  return effect;
}

/**
 * Balance at the end of `asOf`. Null before the account's opening date:
 * the balance is unknown then, not zero.
 */
export function accountBalance(
  account: Account,
  transactions: readonly Transaction[],
  asOf: IsoDate,
): Centimes | null {
  if (asOf < account.openingDate) return null;
  let balance = account.openingBalance;
  for (const tx of transactions) {
    if (tx.date < account.openingDate || tx.date > asOf) continue;
    if (tx.kind === "transfer" && tx.transferAccountId === tx.accountId) {
      throw new RangeError(`Transaction ${tx.id} transfers an account to itself`);
    }
    balance = add(balance, effectOn(account.id, tx));
  }
  return balance;
}

export interface Position {
  asOf: IsoDate;
  available: Centimes;
  savings: Centimes;
  netWorth: Centimes;
}

/**
 * Combined position at the end of `asOf`. Null unless every account is open
 * by then - a partial total would understate the position without saying so.
 */
export function positionAt(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
  asOf: IsoDate,
): Position | null {
  if (accounts.length === 0) return null;
  let available = ZERO;
  let savings = ZERO;
  for (const account of accounts) {
    const balance = accountBalance(account, transactions, asOf);
    if (balance === null) return null;
    if (account.kind === "savings") savings = add(savings, balance);
    else available = add(available, balance);
  }
  return { asOf, available, savings, netWorth: add(available, savings) };
}
