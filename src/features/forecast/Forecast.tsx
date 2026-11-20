import { useMemo, useState } from "react";
import { useLedger } from "../../data/LedgerContext";
import { forecastBalances, formatMAD, sub, type Centimes, type PlannedPurchase } from "../../engine";
import { MonthChart } from "../../ui/charts/MonthChart";
import { MoneyInput, Segmented } from "../../ui/forms";
import { fullDate, monthLong, monthShort } from "../../ui/format";
import { LegendKey, Panel } from "../../ui/primitives";
import { basisText, useBaseline } from "../planning/baseline";
import "../planning/planning.css";

const money = (amount: Centimes) => formatMAD(amount, { decimals: "auto" });

export function Forecast() {
  const { ledger, today } = useLedger();
  const base = useBaseline();
  const [horizon, setHorizon] = useState<"3" | "6" | "12" | "24">("12");
  const [variable, setVariable] = useState(base.variable);
  const [included, setIncluded] = useState<Record<string, boolean>>({});

  // Goals that can be placed on the timeline: bought when wanted, or else when affordable.
  const candidates = base.activeGoals
    .map(({ goal, plan }) => ({ goal, plan, date: goal.targetDate && goal.targetDate > today ? goal.targetDate : plan.estimatedDate }))
    .filter((c): c is typeof c & { date: string } => c.date !== null && c.date > today);
  const purchases: PlannedPurchase[] = candidates
    .filter((c) => included[c.goal.id])
    .map((c) => ({ name: c.goal.name, date: c.date, amount: c.plan.upfrontTotal, monthlyOwnership: c.plan.monthlyOwnership }));

  const months = Number(horizon);
  const common = { accounts: ledger.accounts, transactions: ledger.transactions, schedules: ledger.schedules, today, months, monthlyVariable: variable };
  const baseline = useMemo(() => forecastBalances(common), [ledger, today, months, variable]); // eslint-disable-line react-hooks/exhaustive-deps
  const planned = useMemo(() => forecastBalances({ ...common, purchases }), [ledger, today, months, variable, JSON.stringify(purchases)]); // eslint-disable-line react-hooks/exhaustive-deps
  const comparing = purchases.length > 0;
  const shown = comparing ? planned : baseline;

  if (!baseline.start) {
    return (
      <div className="settings__note">
        <h2>Nothing to forecast yet</h2>
        <p>A forecast starts from your current balances. Add an account in Settings, then your recurring income and expenses.</p>
      </div>
    );
  }

  const warnings = shown.months.filter((m) => m.warnings.length > 0);
  return (
    <div className="plan">
      <Panel title="Assumptions" className="plan__inputs">
        <div className="plan__fields">
          <MoneyInput
            label="Variable spending per month"
            value={variable}
            onChange={setVariable}
            sliderMax={Math.max(15_000, Math.round(base.variable / 50))}
            hint="Food, transport, shopping: everything not scheduled as recurring."
          />
          <div className="field">
            <span className="field__label">Planned purchases</span>
            {candidates.length === 0 ? (
              <span className="field__hint">Active goals with a date appear here so you can see their effect.</span>
            ) : (
              candidates.map((c) => (
                <label className="check" key={c.goal.id}>
                  <input type="checkbox" checked={!!included[c.goal.id]} onChange={(e) => setIncluded((prev) => ({ ...prev, [c.goal.id]: e.target.checked }))} />
                  <span>{c.goal.name}, {money(c.plan.upfrontTotal)} on {fullDate(c.date)}</span>
                </label>
              ))
            )}
          </div>
        </div>
        <p className="plan__basis">
          Starts from today's balances ({money(baseline.start.available)} available, {money(baseline.start.savings)} savings)
          and applies your {ledger.schedules.filter((s) => !s.paused).length} active recurring items. {basisText(base.monthsUsed)}
        </p>
      </Panel>

      <div className="plan__results">
        <Panel
          title="Projected net worth"
          aside={
            comparing ? (
              <>
                <LegendKey color="var(--series-accent)" label="With purchases" shape="line" />
                <LegendKey color="var(--series-2)" label="Without" shape="line" />
              </>
            ) : undefined
          }
        >
          <div className="plan__horizon">
            <Segmented label="Period" value={horizon} onChange={setHorizon} options={(["3", "6", "12", "24"] as const).map((h) => ({ value: h, label: `${h} mo` }))} />
          </div>
          {warnings.length > 0 && (
            <ul className="warning-list" role="alert">
              {warnings.slice(0, 3).map((m) => (
                <li key={m.month}><b>{monthLong(m.month)}:</b> {m.warnings.join(" ")}</li>
              ))}
              {warnings.length > 3 && <li>…and {warnings.length - 3} more months.</li>}
            </ul>
          )}
          <MonthChart
            kind="lines"
            height={260}
            label="Projected net worth at each month end"
            months={shown.months.map((m, i) => ({
              key: m.month,
              label: m.month.endsWith("-01") || i === 0 ? `${monthShort(m.month)} ${m.month.slice(2, 4)}` : monthShort(m.month),
              title: `End of ${monthLong(m.month)}`,
            }))}
            series={
              comparing
                ? [
                    { name: "With purchases", color: "var(--series-accent)", values: planned.months.map((m) => m.netWorth) },
                    { name: "Without", color: "var(--series-2)", values: baseline.months.map((m) => m.netWorth) },
                  ]
                : [{ name: "Net worth", color: "var(--series-accent)", values: baseline.months.map((m) => m.netWorth) }]
            }
          />
        </Panel>

        <Panel title={comparing ? "Month by month, with purchases" : "Month by month"}>
          <div className="plan__table-wrap">
            <table className="plan__table">
              <thead>
                <tr>
                  <th>Month end</th><th>Income</th><th>Expenses</th><th>Purchases</th><th>Available</th><th>Savings</th>
                  {comparing && <th>Net worth vs without</th>}
                </tr>
              </thead>
              <tbody>
                {shown.months.map((m, i) => (
                  <tr key={m.month}>
                    <th scope="row">{monthLong(m.month)}</th>
                    <td className="tnum">{money(m.income)}</td>
                    <td className="tnum">{money(m.expenses)}</td>
                    <td className="tnum">{m.purchases > 0 ? money(m.purchases) : "—"}</td>
                    <td className={`tnum ${m.available < 0 ? "is-bad" : ""}`} data-figure>{money(m.available)}</td>
                    <td className="tnum" data-figure>{money(m.savings)}</td>
                    {comparing && <td className="tnum">{formatMAD(sub(m.netWorth, baseline.months[i].netWorth), { decimals: "auto", signed: true })}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="plan__note">
            Income and expenses are your recurring items plus the variable spending assumed on the left; the first row
            covers only the rest of this month. Purchases are paid from savings first. A projection from stated
            assumptions, not a prediction.
          </p>
        </Panel>
      </div>
    </div>
  );
}
