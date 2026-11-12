import { RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { useLedger } from "../../data/LedgerContext";
import {
  DEFAULT_SCENARIOS,
  ZERO,
  add,
  addMonths,
  formatBps,
  formatMAD,
  monthOf,
  projectScenarios,
  type Centimes,
  type Projection,
  type Scenario,
} from "../../engine";
import { MonthChart } from "../../ui/charts/MonthChart";
import { MoneyInput, Segmented } from "../../ui/forms";
import { fullDate, monthLong, monthShort } from "../../ui/format";
import { LegendKey, Panel } from "../../ui/primitives";
import { basisText, useBaseline } from "../planning/baseline";
import "../planning/planning.css";

const HORIZONS = ["3", "6", "12", "24", "custom"] as const;
const COLORS: Record<string, string> = {
  conservative: "var(--series-2)",
  normal: "var(--series-accent)",
  aggressive: "var(--series-3)",
};

export function Simulator() {
  const { today } = useLedger();
  const base = useBaseline();
  const [income, setIncome] = useState(base.income);
  const [additional, setAdditional] = useState<Centimes>(ZERO);
  const [expenses, setExpenses] = useState(base.expenses);
  const [saveAll, setSaveAll] = useState(base.goalsMonthly === 0);
  const [contribution, setContribution] = useState(base.goalsMonthly);
  const [savings, setSavings] = useState(base.savings);
  const [target, setTarget] = useState<Centimes>(ZERO);
  const [horizon, setHorizon] = useState<(typeof HORIZONS)[number]>("12");
  const [custom, setCustom] = useState(36);
  const [spread, setSpread] = useState(10);

  const months = horizon === "custom" ? Math.min(120, Math.max(1, custom || 1)) : Number(horizon);
  const scenarios = useMemo<Scenario[]>(
    () =>
      DEFAULT_SCENARIOS.map((s) =>
        s.id === "conservative" ? { ...s, expensesBps: spread * 100 } : s.id === "aggressive" ? { ...s, expensesBps: -spread * 100 } : s,
      ),
    [spread],
  );
  const projections = useMemo(
    () =>
      projectScenarios(
        {
          startingSavings: savings,
          monthlyIncome: income,
          additionalIncome: additional,
          monthlyExpenses: expenses,
          monthlyContribution: saveAll ? null : contribution,
          target: target > 0 ? target : null,
        },
        months,
        monthOf(today),
        scenarios,
      ),
    [savings, income, additional, expenses, saveAll, contribution, target, months, today, scenarios],
  );

  const reset = () => {
    setIncome(base.income);
    setAdditional(ZERO);
    setExpenses(base.expenses);
    setSavings(base.savings);
    setContribution(base.goalsMonthly);
    setSaveAll(base.goalsMonthly === 0);
  };
  const maxOf = (value: Centimes, floor: number) => Math.max(floor, Math.round(value / 50));
  const points = projections[0].points;

  return (
    <div className="plan">
      <Panel
        title="Your figures"
        className="plan__inputs"
        aside={
          <button className="button button--quiet" onClick={reset} title="Reset to the figures from your records">
            <RotateCcw size={13} /> Reset
          </button>
        }
      >
        <div className="plan__fields">
          <MoneyInput label="Monthly salary" value={income} onChange={setIncome} sliderMax={maxOf(base.income, 30_000)} />
          <MoneyInput label="Additional income" value={additional} onChange={setAdditional} sliderMax={10_000} hint="Irregular income such as freelance, per month" />
          <MoneyInput label="Monthly expenses" value={expenses} onChange={setExpenses} sliderMax={maxOf(base.expenses, 30_000)} />
          <MoneyInput
            label="Monthly savings contribution"
            value={contribution}
            onChange={setContribution}
            sliderMax={maxOf(base.income, 30_000)}
            disabled={saveAll}
            hint={
              <label className="check plan__inline-check">
                <input type="checkbox" checked={saveAll} onChange={(e) => setSaveAll(e.target.checked)} />
                <span>Save everything left after expenses</span>
              </label>
            }
          />
          <MoneyInput label="Current savings" value={savings} onChange={setSavings} />
          <MoneyInput label="Target amount" value={target} onChange={setTarget} hint="Optional. Leave at 0 for no target." />
        </div>
        <p className="plan__basis">{basisText(base.monthsUsed)}</p>
      </Panel>

      <div className="plan__results">
        <Panel
          title={`Savings over ${months} ${months === 1 ? "month" : "months"}`}
          aside={projections.map((p) => <LegendKey key={p.scenario.id} color={COLORS[p.scenario.id]} label={p.scenario.label} shape="line" />)}
        >
          <div className="plan__horizon">
            <Segmented
              label="Period"
              value={horizon}
              onChange={setHorizon}
              options={HORIZONS.map((h) => ({ value: h, label: h === "custom" ? "Custom" : `${h} mo` }))}
            />
            {horizon === "custom" && (
              <label className="plan__number">
                <input className="input tnum" type="number" min={1} max={120} value={custom} onChange={(e) => setCustom(Number(e.target.value))} aria-label="Months" />
                months
              </label>
            )}
          </div>
          <MonthChart
            kind="lines"
            height={260}
            label="Projected savings under three scenarios"
            months={points.map((p) => ({
              key: p.month,
              label: p.month.endsWith("-01") || p.index === 0 ? `${monthShort(p.month)} ${p.month.slice(2, 4)}` : monthShort(p.month),
              title: p.index === 0 ? `Today (${monthLong(p.month)})` : monthLong(p.month),
            }))}
            series={[projections[1], projections[0], projections[2]].map((p) => ({ name: p.scenario.label, color: COLORS[p.scenario.id], values: p.points.map((pt) => pt.savings) }))}
            reference={target > 0 ? { value: target, label: `Target ${formatMAD(target, { decimals: "auto" })}` } : null}
          />
        </Panel>

        <Panel
          title="Scenarios side by side"
          aside={
            <label className="plan__number">
              Expense swing ±
              <input className="input tnum" type="number" min={0} max={50} value={spread} onChange={(e) => setSpread(Math.min(50, Math.max(0, Number(e.target.value))))} aria-label="Expense swing percent" />%
            </label>
          }
        >
          <div className="plan__table-wrap">
            <table className="plan__table">
              <thead>
                <tr>
                  <th />
                  {projections.map((p) => (
                    <th key={p.scenario.id}><LegendKey color={COLORS[p.scenario.id]} label={p.scenario.label} shape="line" /></th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <Row label="Assumption" cells={projections.map((p) => assumption(p.scenario))} quiet />
                <Row label="Income counted" cells={projections.map((p) => formatMAD(add(p.income, p.additionalIncome), { decimals: "auto" }))} />
                <Row label="Expenses" cells={projections.map((p) => formatMAD(p.expenses, { decimals: "auto" }))} />
                <Row label="Left each month" cells={projections.map((p) => formatMAD(p.surplus, { decimals: "auto", signed: true }))} />
                <Row label="Saved each month" cells={projections.map((p) => formatMAD(p.contribution, { decimals: "auto", signed: true }) + (p.shortfall ? " *" : ""))} />
                <Row label={`Savings after ${months} months`} cells={projections.map((p) => formatMAD(p.finalSavings, { decimals: "auto" }))} strong />
                {target > 0 && <Row label="Target reached" cells={projections.map((p) => reached(p, today))} strong />}
              </tbody>
            </table>
          </div>
          {projections.some((p) => p.shortfall) && (
            <p className="plan__note">* What is left each month is less than the contribution you asked for, so only that is saved.</p>
          )}
          <p className="plan__note">
            Straight arithmetic on the figures above: savings grow by the same amount every month. No interest, inflation
            or investment return is assumed. A projection, not a promise.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function assumption(s: Scenario): string {
  const parts = [];
  parts.push(s.expensesBps === 0 ? "Expenses as entered" : `Expenses ${formatBps(s.expensesBps, { signed: true })}`);
  if (s.additionalIncomeShareBps < 10_000) parts.push(s.additionalIncomeShareBps === 0 ? "no additional income" : `${formatBps(s.additionalIncomeShareBps)} of additional income`);
  return parts.join(", ");
}

function reached(p: Projection, today: string): string {
  if (p.monthsToTarget === null) return "Never at this rate";
  if (p.monthsToTarget === 0) return "Already reached";
  return `${p.monthsToTarget} months · ${fullDate(addMonths(today, p.monthsToTarget)).replace(/^\d+ /, "")}`;
}

function Row(props: { label: string; cells: string[]; strong?: boolean; quiet?: boolean }) {
  return (
    <tr className={props.strong ? "is-strong" : props.quiet ? "is-quiet" : ""}>
      <th scope="row">{props.label}</th>
      {props.cells.map((cell, i) => (
        <td key={i} className="tnum" data-figure>{cell}</td>
      ))}
    </tr>
  );
}
