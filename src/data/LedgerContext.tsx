import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { today as readToday, type IsoDate } from "../engine";
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
}

const LedgerContext = createContext<LedgerState | null>(null);

/** Lock automatically after this long without keyboard or pointer activity. */
const AUTO_LOCK_MS = 10 * 60 * 1000;

export function LedgerProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>(hasBackend ? "loading" : "preview");
  const [stored, setStored] = useState<Ledger>(EMPTY_LEDGER);
  const [isDemo, setDemo] = useState(false);
  const today = useMemo(() => readToday(), []);

  const reload = useCallback(async () => setStored(await api.loadLedger()), []);

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
    () => ({ status, ledger, today, isDemo, setDemo, canEdit: status === "ready" && !isDemo, create, unlock, lock, mutate }),
    [status, ledger, today, isDemo, create, unlock, lock, mutate],
  );
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerState {
  const state = useContext(LedgerContext);
  if (!state) throw new Error("useLedger must be used inside LedgerProvider");
  return state;
}
