import {
  ArrowLeftRight,
  Calculator,
  LayoutDashboard,
  LineChart,
  MessageSquareText,
  Settings,
  SlidersHorizontal,
  Target,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

export type RouteId =
  | "command-center"
  | "transactions"
  | "simulator"
  | "goals"
  | "affordability"
  | "forecast"
  | "assistant"
  | "settings";

export interface Route {
  id: RouteId;
  label: string;
  icon: LucideIcon;
  group: "Overview" | "Money" | "Planning" | "Intelligence" | "System";
  /** What the module will do, shown until it is built. */
  summary: string;
  /** Roadmap phase that delivers it; null once it exists. */
  phase: number | null;
}

export const ROUTES: Route[] = [
  { id: "command-center", label: "Command Center", icon: LayoutDashboard, group: "Overview", summary: "", phase: null },
  { id: "transactions", label: "Transactions", icon: ArrowLeftRight, group: "Money", phase: 3,
    summary: "Record income and expenses, manage categories and recurring items, search and filter history, import and export CSV." },
  { id: "simulator", label: "Savings Simulator", icon: SlidersHorizontal, group: "Planning", phase: 4,
    summary: "Change salary, expenses and contributions and see the effect over 3 to 24 months, under conservative, normal and aggressive assumptions." },
  { id: "goals", label: "Purchase Goals", icon: Target, group: "Planning", phase: 4,
    summary: "Plan a motorcycle or car purchase with its full cost of ownership, and compare options side by side." },
  { id: "affordability", label: "Affordability", icon: Calculator, group: "Planning", phase: 4,
    summary: "Test a purchase before making it: what remains, how long recovery takes, and whether it puts goals at risk." },
  { id: "forecast", label: "Forecast", icon: LineChart, group: "Planning", phase: 4,
    summary: "Projected balances from recurring income, expenses and planned purchases, with warnings when funds fall short." },
  { id: "assistant", label: "Assistant", icon: MessageSquareText, group: "Intelligence", phase: 5,
    summary: "Ask questions about your records. Optional, off by default, and every figure is traceable to a calculation." },
  { id: "settings", label: "Settings", icon: Settings, group: "System", phase: 3,
    summary: "Passphrase and auto-lock, encrypted backup and restore, full export and deletion." },
];

const DEFAULT_ROUTE: RouteId = "command-center";

function readHash(): RouteId {
  const id = window.location.hash.replace(/^#\/?/, "");
  return ROUTES.some((r) => r.id === id) ? (id as RouteId) : DEFAULT_ROUTE;
}

/** Hash-based routing: enough for a single-window app, and Back/Forward work. */
export function useRoute(): [RouteId, (id: RouteId) => void] {
  const [route, setRoute] = useState<RouteId>(readHash);
  useEffect(() => {
    const onChange = () => setRoute(readHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [route, (id) => (window.location.hash = `/${id}`)];
}
