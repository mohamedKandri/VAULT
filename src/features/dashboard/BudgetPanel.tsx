import { useMemo, useState } from "react";
import { useLedger } from "../../data/LedgerContext";
import { financialHealth, formatBps, formatMAD, safeToSpend } from "../../engine";
import { Money, Panel } from "../../ui/primitives";

/**
 * Safe-to-spend for the current month plus health indicators. The calculation
 * is always one click away: every line that produced the figure is listed.
 */
export function BudgetPanel() {
  const { ledger, today } = useLedger();
  const [open, setOpen] = useState(false);
  const budget = useMemo(() => safeToSpend(ledger.accounts, ledger.transactions, ledger.schedules, today), [ledger, today]);
  const health = useMemo(() => financialHealth(ledger.accounts, ledger.transactions, today), [ledger, today]);

  const over = budget.remaining < 0;
  const used = budget.spendingLimit > 0 ? Math.min(100, (budget.variableSpent / budget.spendingLimit) * 100) : over ? 100 : 0;
  const tone = over ? "bad" : used > 85 ? "warn" : "ok";

  return (
    <Panel title="Spending limit" className="dash__third" aside={<span>{budget.daysLeft} {budget.daysLeft === 1 ? "day" : "days"} left</span>}>
      <div className="budget__figure">
        <Money amount={budget.remaining} size="figure" />
        <span className={`budget__state budget__state--${tone}`}>{over ? "over the limit" : "safe to spend"}</span>
      </div>
      <div
        className="budget__meter"
        role="meter"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(used)}
        aria-label="Share of the monthly spending limit used"
      >
        <span className={`budget__fill budget__fill--${tone}`} style={{ width: `${used}%` }} />
      </div>
      <p className="budget__caption">
        {formatMAD(budget.variableSpent, { decimals: "auto" })} spent of a {formatMAD(budget.spendingLimit, { decimals: "auto" })} limit
        {budget.perDay !== null && <> · about {formatMAD(budget.perDay, { decimals: "auto" })} a day</>}
      </p>

      <button className="budget__toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        {open ? "Hide the calculation" : "How this is calculated"}
      </button>
      {open && (
        <table className="budget__lines">
          <tbody>
            {budget.lines.map((line) => (
              <tr key={line.label}>
                <th scope="row">{line.label}</th>
                <td className="tnum">{formatMAD(line.amount, { code: false, signed: true })}</td>
              </tr>
            ))}
            <tr className="budget__total">
              <th scope="row">Safe to spend</th>
              <td className="tnum">{formatMAD(budget.remaining, { code: false, signed: true })}</td>
            </tr>
          </tbody>
        </table>
      )}

      <dl className="health">
        <div title="Net worth divided by average monthly expenses">
          <dt>Expense cover</dt>
          <dd>{health.coverTenths === null ? "—" : `${(health.coverTenths / 10).toFixed(1)} months`}</dd>
        </div>
        <div title="Average fixed expenses as a share of average income">
          <dt>Fixed costs</dt>
          <dd>{health.fixedShareBps === null ? "—" : `${formatBps(Math.round(health.fixedShareBps / 100) * 100)} of income`}</dd>
        </div>
        <div title="Average income minus expenses, as a share of income">
          <dt>Savings rate</dt>
          <dd>{health.savingsRateBps === null ? "—" : formatBps(Math.round(health.savingsRateBps / 100) * 100)}</dd>
        </div>
      </dl>
      <p className="budget__basis">
        {health.monthsUsed === 0
          ? "Health indicators need one complete month of records."
          : `Health indicators average the last ${health.monthsUsed} complete ${health.monthsUsed === 1 ? "month" : "months"}.`}
      </p>
    </Panel>
  );
}
