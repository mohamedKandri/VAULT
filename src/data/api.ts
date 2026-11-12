/**
 * Typed wrappers around the Rust commands: the only way the interface reaches
 * stored data. Amounts cross the boundary as integer centimes.
 */

import { invoke } from "@tauri-apps/api/core";
import { centimes, type AccountKind, type Centimes, type DueOccurrence, type Frequency, type IsoDate, type TransactionKind } from "../engine";
import type { Ledger } from "./ledger";

/** False when the interface runs in a plain browser (UI development) with no Rust backend. */
export const hasBackend = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    const e = error as { code?: string; message?: string };
    throw new ApiError(e?.code ?? "internal", e?.message ?? String(error));
  }
}

export interface VaultStatus {
  exists: boolean;
  unlocked: boolean;
}

export interface AccountInput {
  name: string;
  kind: AccountKind;
  openingBalance: Centimes;
  openingDate: IsoDate;
}

export interface CategoryInput {
  name: string;
  kind: "income" | "expense";
  isFixedDefault: boolean;
}

export interface TransactionInput {
  accountId: string;
  date: IsoDate;
  kind: TransactionKind;
  amount: Centimes;
  categoryId: string | null;
  transferAccountId: string | null;
  description: string;
  notes: string;
  isFixed: boolean;
}

export interface ScheduleInput {
  /** `template.date` is the first occurrence. */
  template: TransactionInput;
  frequency: Frequency;
  interval: number;
  endDate: IsoDate | null;
  paused: boolean;
}

interface RawLedger {
  accounts: { id: string; name: string; kind: AccountKind; openingBalance: number; openingDate: string; archived: boolean }[];
  categories: { id: string; name: string; kind: "income" | "expense"; isFixedDefault: boolean; archived: boolean }[];
  transactions: {
    id: string; accountId: string; date: string; kind: TransactionKind; amount: number;
    categoryId: string | null; transferAccountId: string | null; description: string; notes: string; isFixed: boolean;
  }[];
  schedules: {
    id: string; accountId: string; kind: TransactionKind; amount: number; categoryId: string | null;
    transferAccountId: string | null; description: string; isFixed: boolean; frequency: Frequency; interval: number;
    startDate: string; endDate: string | null; paused: boolean; postedThrough: string | null;
  }[];
}

/** Re-validate every amount as it enters the engine: a non-integer would throw here, not corrupt a total. */
function toLedger(raw: RawLedger): Ledger {
  return {
    accounts: raw.accounts.map((a) => ({ ...a, openingBalance: centimes(a.openingBalance) })),
    categories: raw.categories,
    transactions: raw.transactions.map((t) => ({ ...t, amount: centimes(t.amount) })),
    schedules: raw.schedules.map((s) => ({
      id: s.id,
      rule: { frequency: s.frequency, interval: s.interval, startDate: s.startDate, endDate: s.endDate },
      accountId: s.accountId,
      kind: s.kind,
      amount: centimes(s.amount),
      categoryId: s.categoryId,
      transferAccountId: s.transferAccountId,
      description: s.description,
      isFixed: s.isFixed,
      paused: s.paused,
      postedThrough: s.postedThrough,
    })),
  };
}

export const api = {
  status: () => call<VaultStatus>("vault_status"),
  create: (passphrase: string) => call<void>("vault_create", { passphrase }),
  unlock: (passphrase: string) => call<void>("vault_unlock", { passphrase }),
  lock: () => call<void>("vault_lock"),
  changePassphrase: (current: string, next: string) => call<void>("vault_change_passphrase", { current, new: next }),

  loadLedger: async () => toLedger(await call<RawLedger>("ledger_load")),

  saveAccount: (id: string | null, input: AccountInput) => call<string>("account_save", { id, input }),
  setAccountArchived: (id: string, archived: boolean) => call<void>("account_set_archived", { id, archived }),
  deleteAccount: (id: string) => call<void>("account_delete", { id }),

  saveCategory: (id: string | null, input: CategoryInput) => call<string>("category_save", { id, input }),
  setCategoryArchived: (id: string, archived: boolean) => call<void>("category_set_archived", { id, archived }),

  saveTransaction: (id: string | null, input: TransactionInput) => call<string>("transaction_save", { id, input }),
  deleteTransaction: (id: string) => call<void>("transaction_delete", { id }),

  saveSchedule: (id: string | null, input: ScheduleInput) => call<string>("schedule_save", { id, input }),
  deleteSchedule: (id: string) => call<void>("schedule_delete", { id }),
  postDue: (due: DueOccurrence[], through: IsoDate) => call<number>("schedule_post_due", { due, through }),
};
