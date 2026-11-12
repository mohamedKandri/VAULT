import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { today as readToday, type IsoDate } from "../engine";
import { buildDemoLedger } from "./demoLedger";
import { EMPTY_LEDGER, type Ledger } from "./ledger";

interface LedgerState {
  ledger: Ledger;
  today: IsoDate;
  /** True while fictional sample data is shown instead of the user's records. */
  isDemo: boolean;
  setDemo: (on: boolean) => void;
}

const LedgerContext = createContext<LedgerState | null>(null);

/**
 * Source of the ledger for the whole app.
 *
 * Until encrypted storage lands (Phase 3) the real ledger is empty: the app
 * shows honest empty states, or the labelled demo ledger when the user asks
 * for it. Demo mode lives in memory only and resets on restart.
 */
export function LedgerProvider({ children }: { children: ReactNode }) {
  const [isDemo, setDemo] = useState(false);
  const today = useMemo(() => readToday(), []);
  const ledger = useMemo(() => (isDemo ? buildDemoLedger(today) : EMPTY_LEDGER), [isDemo, today]);
  const value = useMemo(() => ({ ledger, today, isDemo, setDemo }), [ledger, today, isDemo]);
  return <LedgerContext.Provider value={value}>{children}</LedgerContext.Provider>;
}

export function useLedger(): LedgerState {
  const state = useContext(LedgerContext);
  if (!state) throw new Error("useLedger must be used inside LedgerProvider");
  return state;
}
