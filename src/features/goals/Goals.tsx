import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import { api, type GoalInput } from "../../data/api";
import { useLedger } from "../../data/LedgerContext";
import {
  VEHICLE_COST_LABELS,
  ZERO,
  formatBps,
  formatMAD,
  planGoal,
  type Centimes,
  type CostFrequency,
  type Goal,
  type GoalPlan,
} from "../../engine";
import { AmountField, Dialog, Field, readAmount, useSubmit } from "../../ui/forms";
import { fullDate } from "../../ui/format";
import { Panel } from "../../ui/primitives";
import { useBaseline } from "../planning/baseline";
import "../planning/planning.css";

const money = (amount: Centimes | null, signed = false) => (amount === null ? "—" : formatMAD(amount, { decimals: "auto", signed }));
const monthYear = (date: string | null) => (date ? fullDate(date).replace(/^\d+ /, "") : "—");

function status(goal: Goal, plan: GoalPlan): { text: string; tone: "good" | "bad" | "flat" } {
  if (goal.status === "achieved") return { text: "Achieved", tone: "good" };
  if (plan.remaining === 0) return { text: "Fully funded", tone: "good" };
  if (plan.monthsAtContribution === null) return { text: "No monthly contribution", tone: "flat" };
  if (plan.onTrack === true) return { text: "On track", tone: "good" };
  if (plan.onTrack === false) return { text: "Behind the target date", tone: "bad" };
  return { text: `${plan.monthsAtContribution} months to go`, tone: "flat" };
}

export function Goals() {
  const { ledger, today, canEdit, mutate } = useLedger();
  const base = useBaseline();
  const [dialog, setDialog] = useState<{ goal: Goal | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const goals = ledger.goals.filter((g) => g.status !== "archived");
  const plans = new Map(goals.map((g) => [g.id, planGoal(g, today, base.surplus)]));
  const active = goals.filter((g) => g.status === "active");

  const run = (change: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await mutate(change);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const withStatus = (goal: Goal, next: Goal["status"]): GoalInput => {
    const { id: _id, ...rest } = goal;
    return { ...rest, status: next };
  };

  return (
    <div className="goals">
      <div className="goals__head">
        <p>
          Plan a purchase with everything it costs: the price, one-off costs such as registration, and what owning it
          costs every month afterwards.
        </p>
        <button className="button button--primary" onClick={() => setDialog({ goal: null })} disabled={!canEdit}>
          <Plus size={15} /> Add goal
        </button>
      </div>

      {goals.length === 0 ? (
        <p className="tx__none">No goals yet. Add the motorcycle or the car you have in mind to see when it becomes affordable.</p>
      ) : (
        <div className="goals__grid">
          {goals.map((goal) => {
            const plan = plans.get(goal.id)!;
            const s = status(goal, plan);
            return (
              <Panel key={goal.id} title={`Priority ${goal.priority}`} className="goal">
                <div className="goal__top">
                  <span className="goal__name">{goal.name}</span>
                  <span className={`goal__status goal__status--${s.tone}`}>{s.text}</span>
                </div>
                <div className="goal__bar" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(plan.progressBps / 100)} aria-label={`${goal.name} progress`}>
                  <span style={{ width: `${plan.progressBps / 100}%` }} />
                </div>
                <div className="goal__progress">
                  <span><b className="tnum">{money(goal.savedAmount)}</b> of {money(plan.upfrontTotal)}</span>
                  <span className="tnum">{formatBps(Math.round(plan.progressBps / 100) * 100)}</span>
                </div>
                <dl className="facts">
                  <div><dt>Still to save</dt><dd>{money(plan.remaining)}</dd></div>
                  <div><dt>Saving per month</dt><dd>{money(goal.monthlyContribution)}</dd></div>
                  <div>
                    <dt>Ready by</dt>
                    <dd>{monthYear(plan.estimatedDate)}{goal.targetDate && <small>wanted by {monthYear(goal.targetDate)}</small>}</dd>
                  </div>
                  <div>
                    <dt>{goal.targetDate ? "Needed per month" : "One-off costs"}</dt>
                    <dd>{goal.targetDate ? money(plan.requiredMonthly) : money(plan.oneOffCosts)}</dd>
                  </div>
                  <div><dt>Cost of owning it</dt><dd>{money(plan.monthlyOwnership)}<small>per month, after buying</small></dd></div>
                  <div><dt>First-year total</dt><dd>{money(plan.firstYearCost)}</dd></div>
                </dl>
                {canEdit && (
                  <div className="goal__actions">
                    <button className="icon-button" title="Edit" aria-label={`Edit ${goal.name}`} onClick={() => setDialog({ goal })}><Pencil size={14} /></button>
                    <button
                      className="icon-button"
                      title={goal.status === "achieved" ? "Mark as active again" : "Mark as achieved"}
                      aria-label={goal.status === "achieved" ? "Mark as active again" : "Mark as achieved"}
                      onClick={run(() => api.saveGoal(goal.id, withStatus(goal, goal.status === "achieved" ? "active" : "achieved")))}
                    >
                      <Check size={14} />
                    </button>
                    <button className="icon-button" title="Delete" aria-label={`Delete ${goal.name}`} onClick={run(() => api.deleteGoal(goal.id))}><Trash2 size={14} /></button>
                  </div>
                )}
              </Panel>
            );
          })}
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}

      {active.length >= 2 && (
        <Panel title="Compare" aside={<span>{base.surplus === null ? "Impact figures need a complete month of records" : `Based on ${money(base.surplus)} left each month on average`}</span>}>
          <div className="plan__table-wrap">
            <table className="plan__table">
              <thead>
                <tr><th />{active.map((g) => <th key={g.id}>{g.name}</th>)}</tr>
              </thead>
              <tbody>
                {(
                  [
                    ["Purchase price", (g, _p) => money(g.targetPrice)],
                    ["One-off costs", (_g, p) => money(p.oneOffCosts)],
                    ["Needed on purchase day", (_g, p) => money(p.upfrontTotal), true],
                    ["Already saved", (g, _p) => money(g.savedAmount)],
                    ["Still to save", (_g, p) => money(p.remaining)],
                    ["Saving per month", (g, _p) => money(g.monthlyContribution)],
                    ["Months until affordable", (_g, p) => (p.monthsAtContribution === null ? "Never at this rate" : String(p.monthsAtContribution)), true],
                    ["Ready by", (_g, p) => monthYear(p.estimatedDate)],
                    ["Cost of owning it, per month", (_g, p) => money(p.monthlyOwnership)],
                    ["First-year total", (_g, p) => money(p.firstYearCost), true],
                    ["Share of monthly surplus while saving", (_g, p) => (p.contributionShareBps === null ? "—" : formatBps(Math.round(p.contributionShareBps / 100) * 100))],
                    ["Left each month after buying", (_g, p) => money(p.surplusAfterPurchase, true)],
                  ] as [string, (g: Goal, p: GoalPlan) => string, boolean?][]
                ).map(([label, cell, strong]) => (
                  <tr key={label} className={strong ? "is-strong" : ""}>
                    <th scope="row">{label}</th>
                    {active.map((g) => <td key={g.id} className="tnum" data-figure>{cell(g, plans.get(g.id)!)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="plan__note">
            "Left each month after buying" is your average monthly surplus minus the cost of owning it. Goal
            contributions stop once the purchase is made.
          </p>
        </Panel>
      )}

      {dialog && <GoalDialog goal={dialog.goal} nextPriority={goals.length + 1} onClose={() => setDialog(null)} />}
    </div>
  );
}

interface CostDraft {
  label: string;
  amountText: string;
  frequency: CostFrequency;
}

function GoalDialog(props: { goal: Goal | null; nextPriority: number; onClose: () => void }) {
  const { mutate } = useLedger();
  const editing = props.goal;
  const text = (amount: Centimes | undefined) => (amount ? formatMAD(amount, { code: false, decimals: "auto" }).replace(/,/g, "") : "");
  const [name, setName] = useState(editing?.name ?? "");
  const [price, setPrice] = useState(text(editing?.targetPrice));
  const [saved, setSaved] = useState(text(editing?.savedAmount));
  const [monthly, setMonthly] = useState(text(editing?.monthlyContribution));
  const [targetDate, setTargetDate] = useState(editing?.targetDate ?? "");
  const [priority, setPriority] = useState(editing?.priority ?? Math.min(99, props.nextPriority));
  const [costs, setCosts] = useState<CostDraft[]>(
    editing?.costs.map((c) => ({ label: c.label, amountText: text(c.amount), frequency: c.frequency })) ?? [],
  );
  const setCost = (index: number, patch: Partial<CostDraft>) => setCosts(costs.map((c, i) => (i === index ? { ...c, ...patch } : c)));
  const priceValue = readAmount(price).value;

  const save = useSubmit(async () => {
    if (priceValue === null || priceValue <= 0) throw new Error("Enter the purchase price.");
    const amount = (t: string) => readAmount(t).value ?? ZERO;
    const lines = costs.filter((c) => c.label.trim() && c.amountText.trim());
    for (const line of lines) {
      const value = readAmount(line.amountText).value;
      if (value === null || value <= 0) throw new Error(`Enter a valid amount for "${line.label}".`);
    }
    await mutate(() =>
      api.saveGoal(editing?.id ?? null, {
        name,
        targetPrice: priceValue,
        savedAmount: amount(saved),
        monthlyContribution: amount(monthly),
        targetDate: targetDate || null,
        priority,
        status: editing?.status ?? "active",
        costs: lines.map((c) => ({ label: c.label.trim(), amount: amount(c.amountText), frequency: c.frequency })),
      }),
    );
    props.onClose();
  });

  return (
    <Dialog title={editing ? "Edit goal" : "New goal"} onClose={props.onClose} width={560}>
      <form className="form" onSubmit={save.submit}>
        <div className="form__row">
          <Field label="What are you saving for?">
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Motorcycle" autoFocus required />
          </Field>
          <AmountField label="Purchase price" text={price} onChange={setPrice} />
        </div>
        <div className="form__row">
          <AmountField label="Already saved for it" text={saved} onChange={setSaved} />
          <AmountField label="Saving per month" text={monthly} onChange={setMonthly} />
        </div>
        <div className="form__row">
          <Field label="Wanted by" hint="Optional">
            <input className="input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} />
          </Field>
          <Field label="Priority" hint="1 is the most important">
            <input className="input tnum" type="number" min={1} max={99} value={priority} onChange={(e) => setPriority(Number(e.target.value))} required />
          </Field>
        </div>

        <div className="costs">
          <div className="costs__head">
            <span>Other costs</span>
            <div className="costs__buttons">
              {costs.length === 0 && (
                <button type="button" className="button button--quiet" onClick={() => setCosts(VEHICLE_COST_LABELS.map((c) => ({ ...c, amountText: "" })))}>
                  Add vehicle costs
                </button>
              )}
              <button type="button" className="button button--quiet" onClick={() => setCosts([...costs, { label: "", amountText: "", frequency: "yearly" }])}>
                <Plus size={13} /> Add cost
              </button>
            </div>
          </div>
          {costs.map((cost, index) => (
            <div className="costs__row" key={index}>
              <input className="input" value={cost.label} onChange={(e) => setCost(index, { label: e.target.value })} placeholder="Label" aria-label="Cost label" maxLength={80} />
              <input className="input tnum" value={cost.amountText} onChange={(e) => setCost(index, { amountText: e.target.value })} placeholder="Amount" aria-label={`${cost.label || "Cost"} amount`} inputMode="decimal" />
              <select className="select" value={cost.frequency} onChange={(e) => setCost(index, { frequency: e.target.value as CostFrequency })} aria-label="How often">
                <option value="once">Once</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
              <button type="button" className="icon-button" onClick={() => setCosts(costs.filter((_, i) => i !== index))} aria-label="Remove cost"><X size={14} /></button>
            </div>
          ))}
          <span className="field__hint">One-off costs are added to what you need on purchase day. Monthly and yearly costs show what owning it will cost. Lines without an amount are ignored.</span>
        </div>

        {save.error && <p className="form-error" role="alert">{save.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={save.busy}>Cancel</button>
          <button className="button button--primary" disabled={save.busy || !name.trim() || priceValue === null || priceValue <= 0}>{save.busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
