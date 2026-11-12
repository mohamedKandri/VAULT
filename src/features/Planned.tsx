import type { Route } from "../app/routes";
import "./planned.css";

/** Honest stand-in for a module that is on the roadmap but not built yet. */
export function Planned({ route }: { route: Route }) {
  return (
    <div className="planned">
      <span className="planned__icon" aria-hidden>
        <route.icon size={22} strokeWidth={1.5} />
      </span>
      <h2 className="planned__title">Not built yet</h2>
      <p className="planned__body">{route.summary}</p>
      <span className="planned__phase">Planned for phase {route.phase}</span>
    </div>
  );
}
