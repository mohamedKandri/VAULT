import { CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { useLedger } from "../../data/LedgerContext";
import { Panel } from "../../ui/primitives";
import { buildInsights, type InsightTone } from "./insights";

const ICONS: Record<InsightTone, { icon: typeof Info; label: string }> = {
  positive: { icon: CircleCheck, label: "Good news" },
  neutral: { icon: Info, label: "For information" },
  caution: { icon: TriangleAlert, label: "Worth a look" },
};

/** Calculated statements about this month, each with the figures behind it. */
export function InsightsPanel() {
  const { ledger, today } = useLedger();
  const insights = useMemo(() => buildInsights(ledger, today), [ledger, today]);
  const [open, setOpen] = useState<string | null>(null);
  if (insights.length === 0) return null;

  return (
    <Panel title="Insights" className="dash__full" aside={<span>Calculated from your records</span>}>
      <ul className="insights">
        {insights.map((insight) => {
          const { icon: Icon, label } = ICONS[insight.tone];
          const expanded = open === insight.id;
          return (
            <li key={insight.id} className={`insight insight--${insight.tone}`}>
              <Icon className="insight__icon" size={16} strokeWidth={1.75} aria-label={label} />
              <div className="insight__body">
                <p className="insight__text selectable">{insight.text}</p>
                {expanded && (
                  <ul className="insight__basis selectable">
                    {insight.basis.map((line) => <li key={line} className="tnum">{line}</li>)}
                  </ul>
                )}
              </div>
              <button className="budget__toggle insight__toggle" onClick={() => setOpen(expanded ? null : insight.id)} aria-expanded={expanded}>
                {expanded ? "Hide" : "How"}
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
