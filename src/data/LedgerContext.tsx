import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { dueOccurrences, today as readToday, type IsoDate } from "../engine";
import { api, hasBackend } from "./api";
import { buildDemoLedger } from "./demoLedger";
import { EMPTY_LEDGER, type Ledger } from "./ledger";

/**
 * loading  asking the backend whether a vault exists
 * setup    no vault yet: choose a passphrase
 * locked   vault exists, passphrase required
 * ready    unlocked; `ledger` is the user's data
 * preview  interface running in a browser with no backend (UI development)
 */
export type SessionStatus = "loading" | "setup" | "locked" | "ready" | "preview";

interface LedgerState {
  status: SessionStatus;
  ledger: Ledger;
  today: IsoDate;
  /** True while fictional sample data is shown instead of the user's records. */
  isDemo: boolean;
  setDemo: (on: boolean) => void;
  /** True when changes can be saved (unlocked vault, not demo). */
  canEdit: boolean;
  create: (passphrase: string) => Promise<void>;
  unlock: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
  /** Run a change against the backend, then reload the ledger. */
  mutate: <T>(change: () => Promise<T>) => Promise<T>;
  /** Reload after the vault was replaced (restore from backup). */
  refresh: () => Promise<void>;
  /** The vault was deleted: back to first-run setup. */
  forget: () => void;
}

const LedgerContext = createContext<LedgerState | null>(null);

/** Lock automatically after this long without keyboard or pointer activity. */
const AUTO_LOCK_MS = 10 * 60 * 1000;

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(hasBackend ? "loading" : "preview");
  const [stored, setStored] = useState<Ledger>(EMPTY_LEDGER);
  const [isDemo, setDemo] = useState(false);
  const today = useMemo(() => readToday(), []);

  // Loading also records any recurring items that have come due since last time.
  const reload = useCallback(async () => {
    let ledger = await api.loadLedger();
    const due = dueOccurrences(ledger.schedules, today);
    const behind = ledger.schedules.some((s) => !s.postedThrough || s.postedThrough < today);
    if (due.length > 0 || behind) {
      await api.postDue(due, today);
      ledger = await api.loadLedger();
    }
    setStored(ledger);
  }, [today]);

  useEffect(() => {
    if (!hasBackend) return;
    api.status().then(async (s) => {
      if (s.unlocked) {
        await reload();
        setStatus("ready");
      } else {
        setStatus(s.exists ? "locked" : "setup");
      }
    });
  }, [reload]);

  const open = useCallback(
    async (action: () => Promise<void>) => {
      await action();
      await reload();
      setStatus("ready");
    },
    [reload],
  );
  const create = useCallback((passphrase: string) => open(() => api.create(passphrase)), [open]);
  const unlock = useCallback((passphrase: string) => open(() => api.unlock(passphrase)), [open]);

  const forget = useCallback(() => {
    setStored(EMPTY_LEDGER);
    setDemo(false);
    setStatus("setup");
  }, []);

  const lock = useCallback(async () => {
    await api.lock();
    setStored(EMPTY_LEDGER); // drop decrypted data from the interface as well
    setDemo(false);
    setStatus("locked");
  }, []);

  const mutate = useCallback(
    async <T,>(change: () => Promise<T>) => {
      const result = await change();
      await reload();
      return result;
    },
    [reload],
  );

  // Auto-lock on inactivity.
  const lockRef = useRef(lock);
  lockRef.current = lock;
  useEffect(() => {
    if (status !== "ready") return;
    let timer = window.setTimeout(() => lockRef.current(), AUTO_LOCK_MS);
    const reset = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => lockRef.current(), AUTO_LOCK_MS);
    };
    const events = ["pointerdown", "keydown", "wheel"] as const;
    events.forEach((name) => window.addEventListener(name, reset, { passive: true }));
    return () => {
      window.clearTimeout(timer);
      events.forEach((name) => window.removeEventListener(name, reset));
    };
  }, [status]);

  const ledger = useMemo(() => (isDemo ? buildDemoLedger(today) : stored), [isDemo, today, stored]);
  const value = useMemo<LedgerState>(
    () => ({ status, ledger, today, isDemo, setDemo, canEdit: status === "ready" && !isDemo, create, unlock, lock, mutate, refresh: reload, forget }),
    [status, ledger, today, isDemo, create, unlock, lock, mutate, reload, forget],
  );
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerState {
  const state = useContext(LedgerContext);
  if (!state) throw new Error("useLedger must be used inside LedgerProvider");
  return state;
}
