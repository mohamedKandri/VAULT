import { Target } from "lucide-react";
import { formatBps, formatMAD } from "../../engine";
import { monthYear } from "../../ui/format";
import { Panel } from "../../ui/primitives";
import { useBaseline } from "../planning/baseline";
import "../planning/planning.css";

/** Active goals, most important first, with progress and the estimated date. */
export function GoalsPanel() {
  const { activeGoals } = useBaseline();
  return (
    <Panel title="Financial goals" className="dash__third" aside={<a className="panel__link" href="#/goals">All goals</a>}>
      {activeGoals.length === 0 ? (
        <div className="pending">
          <span className="pending__icon" aria-hidden><Target size={18} strokeWidth={1.5} /></span>
          <p>No goals yet. Add the purchase you are saving for to see when it becomes affordable.</p>
          <a className="button button--quiet" href="#/goals">Add a goal</a>
        </div>
      ) : (
        <ul className="upcoming">
          {activeGoals.slice(0, 4).map(({ goal, plan }) => (
            <li key={goal.id} className="dashgoal">
              <div className="goal__top">
                <span>{goal.name}</span>
                <span className="tnum quiet">{formatBps(Math.round(plan.progressBps / 100) * 100)}</span>
              </div>
              <div className="goal__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(plan.progressBps / 100)} aria-label={`${goal.name} progress`}>
                <span style={{ width: `${plan.progressBps / 100}%` }} />
              </div>
              <div className="goal__progress">
                <span className="tnum">{formatMAD(plan.remaining, { decimals: "auto" })} to go</span>
                <span>
                  {plan.remaining === 0
                    ? "Fully funded"
                    : plan.estimatedDate
                      ? `Ready ${monthYear(plan.estimatedDate)}`
                      : "No monthly contribution"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
