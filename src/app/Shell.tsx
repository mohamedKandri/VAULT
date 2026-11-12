import { ShieldCheck } from "lucide-react";
import type { ReactNode } from "react";
import { useLedger } from "../data/LedgerContext";
import { Tag } from "../ui/primitives";
import { fullDate } from "../ui/format";
import { ROUTES, type Route, type RouteId } from "./routes";
import "./shell.css";

const GROUPS: Route["group"][] = ["Overview", "Money", "Planning", "Intelligence"];

export function Shell(props: { route: RouteId; onNavigate: (id: RouteId) => void; children: ReactNode }) {
  const { isDemo, setDemo, today } = useLedger();
  const active = ROUTES.find((r) => r.id === props.route)!;

  const link = (route: Route) => (
    <button
      key={route.id}
      className={`nav__link ${route.id === props.route ? "nav__link--active" : ""}`}
      onClick={() => props.onNavigate(route.id)}
      aria-current={route.id === props.route ? "page" : undefined}
      title={route.label}
    >
      <route.icon size={16} strokeWidth={1.75} aria-hidden />
      <span className="nav__label">{route.label}</span>
    </button>
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand" aria-label="VAULT">
          <span className="brand__mark" aria-hidden />
          <span className="brand__name">VAULT</span>
        </div>

        <nav className="nav" aria-label="Main">
          {GROUPS.map((group) => (
            <div className="nav__group" key={group}>
              <div className="nav__heading">{group}</div>
              {ROUTES.filter((r) => r.group === group).map(link)}
            </div>
          ))}
        </nav>

        <div className="sidebar__foot">
          {ROUTES.filter((r) => r.group === "System").map(link)}
          <div className="privacy" title="This build contains no network code. Your data never leaves this computer.">
            <ShieldCheck size={14} strokeWidth={1.75} aria-hidden />
            <span className="nav__label">Local only · no network</span>
          </div>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div>
            <h1 className="topbar__title">{active.label}</h1>
            <p className="topbar__date">{fullDate(today)}</p>
          </div>
          {isDemo && (
            <div className="topbar__demo">
              <Tag tone="caution">Demo data</Tag>
              <span className="topbar__demo-note">Fictional sample figures, not your records.</span>
              <button className="button button--quiet" onClick={() => setDemo(false)}>
                Exit demo
              </button>
            </div>
          )}
        </header>
        <main className="content" key={props.route}>
          {props.children}
        </main>
      </div>
    </div>
  );
}
