import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../data/api";
import { useLedger } from "../../data/LedgerContext";
import {
  describeFrequency,
  formatMAD,
  nextOccurrence,
  type Frequency,
  type Schedule,
  type TransactionKind,
} from "../../engine";
import { AmountField, Dialog, Field, Segmented, readAmount, useSubmit } from "../../ui/forms";
import { fullDate } from "../../ui/format";

const CADENCES: { label: string; frequency: Frequency; interval: number }[] = [
  { label: "Weekly", frequency: "weekly", interval: 1 },
  { label: "Every 2 weeks", frequency: "weekly", interval: 2 },
  { label: "Monthly", frequency: "monthly", interval: 1 },
  { label: "Quarterly", frequency: "monthly", interval: 3 },
  { label: "Yearly", frequency: "yearly", interval: 1 },
];

/** Recurring income, expenses and transfers: salary, rent, subscriptions, savings. */
export function Recurring() {
  const { ledger, today, canEdit, mutate } = useLedger();
  const [dialog, setDialog] = useState<{ schedule: Schedule | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const names = new Map([...ledger.categories, ...ledger.accounts].map((x) => [x.id, x.name]));

  const run = (change: () => Promise<unknown>) => async () => {
    setError(null);
    try {
      await mutate(change);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const toInput = (s: Schedule, paused: boolean) => ({
    template: {
      accountId: s.accountId, date: s.rule.startDate, kind: s.kind, amount: s.amount, categoryId: s.categoryId,
      transferAccountId: s.transferAccountId ?? null, description: s.description, notes: "", isFixed: s.isFixed,
    },
    frequency: s.rule.frequency, interval: s.rule.interval, endDate: s.rule.endDate ?? null, paused,
  });

  return (
    <div className="recurring">
      <div className="recurring__head">
        <p>
          Recurring items are recorded automatically on their date, and count as upcoming in the dashboard and the
          spending limit.
        </p>
        <button className="button button--primary" onClick={() => setDialog({ schedule: null })} disabled={!canEdit || ledger.accounts.length === 0}>
          <Plus size={15} /> Add recurring item
        </button>
      </div>

      {ledger.schedules.length === 0 ? (
        <p className="tx__none">No recurring items yet. Salary, rent and your monthly savings transfer are good first ones.</p>
      ) : (
        <div className="tx__table-wrap">
          <table className="tx__table">
            <thead>
              <tr><th>Description</th><th>Category</th><th>Repeats</th><th>Next</th><th className="tx__col-amount">Amount</th><th /></tr>
            </thead>
            <tbody>
              {ledger.schedules.map((s) => {
                const next = s.paused ? null : nextOccurrence(s.rule, today > s.rule.startDate ? today : s.rule.startDate);
                return (
                  <tr key={s.id} className={s.paused ? "is-paused" : ""}>
                    <td>{s.description || <span className="quiet">No description</span>}</td>
                    <td>{s.kind === "transfer" ? `Transfer → ${names.get(s.transferAccountId ?? "") ?? "?"}` : (names.get(s.categoryId ?? "") ?? "Uncategorized")}</td>
                    <td>{describeFrequency(s.rule)}</td>
                    <td className="tx__account">{s.paused ? "Paused" : next ? fullDate(next) : "Ended"}</td>
                    <td className={`tx__col-amount tnum tx__amount--${s.kind}`} data-figure>
                      {s.kind === "income" ? "+" : s.kind === "expense" ? "−" : ""}
                      {formatMAD(s.amount, { code: false })}
                    </td>
                    <td className="recurring__actions">
                      {canEdit && (
                        <>
                          <button className="icon-button" title="Edit" aria-label={`Edit ${s.description}`} onClick={() => setDialog({ schedule: s })}><Pencil size={14} /></button>
                          <button className="icon-button" title={s.paused ? "Resume" : "Pause"} aria-label={s.paused ? "Resume" : "Pause"} onClick={run(() => api.saveSchedule(s.id, toInput(s, !s.paused)))}>
                            {s.paused ? <Play size={14} /> : <Pause size={14} />}
                          </button>
                          <button className="icon-button" title="Delete (recorded transactions are kept)" aria-label={`Delete ${s.description}`} onClick={run(() => api.deleteSchedule(s.id))}><Trash2 size={14} /></button>
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {error && <p className="form-error" role="alert">{error}</p>}
      {dialog && <ScheduleDialog schedule={dialog.schedule} onClose={() => setDialog(null)} />}
    </div>
  );
}

function ScheduleDialog(props: { schedule: Schedule | null; onClose: () => void }) {
  const { ledger, today, mutate } = useLedger();
  const editing = props.schedule;
  const accounts = ledger.accounts.filter((a) => !a.archived || a.id === editing?.accountId);
  const [kind, setKind] = useState<TransactionKind>(editing?.kind ?? "expense");
  const [amountText, setAmountText] = useState(editing ? formatMAD(editing.amount, { code: false }) : "");
  const [startDate, setStartDate] = useState(editing?.rule.startDate ?? today);
  const [endDate, setEndDate] = useState(editing?.rule.endDate ?? "");
  const [cadence, setCadence] = useState(() => {
    const i = CADENCES.findIndex((c) => c.frequency === editing?.rule.frequency && c.interval === editing?.rule.interval);
    return i >= 0 ? i : 2;
  });
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? "");
  const [transferAccountId, setTransferAccountId] = useState(editing?.transferAccountId ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const amount = readAmount(amountText).value;
  const categories = ledger.categories.filter((c) => c.kind === kind && (!c.archived || c.id === editing?.categoryId));
  const backfills = !editing && startDate < today;

  const save = useSubmit(async () => {
    if (amount === null || amount <= 0) throw new Error("Enter an amount greater than zero.");
    await mutate(() =>
      api.saveSchedule(editing?.id ?? null, {
        template: {
          accountId, date: startDate, kind, amount,
          categoryId: kind === "transfer" ? null : categoryId || null,
          transferAccountId: kind === "transfer" ? transferAccountId || null : null,
          description, notes: "", isFixed: kind === "expense",
        },
        frequency: CADENCES[cadence].frequency,
        interval: CADENCES[cadence].interval,
        endDate: endDate || null,
        paused: editing?.paused ?? false,
      }),
    );
    props.onClose();
  });

  return (
    <Dialog title={editing ? "Edit recurring item" : "New recurring item"} onClose={props.onClose}>
      <form className="form" onSubmit={save.submit}>
        <Segmented
          label="Type"
          value={kind}
          onChange={(k) => { setKind(k); setCategoryId(""); }}
          options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfer" }]}
        />
        <div className="form__row">
          <AmountField label="Amount" text={amountText} onChange={setAmountText} autoFocus={!editing} />
          <Field label="Repeats">
            <select className="select" value={cadence} onChange={(e) => setCadence(Number(e.target.value))}>
              {CADENCES.map((c, i) => <option key={c.label} value={i}>{c.label}</option>)}
            </select>
          </Field>
        </div>
        <div className="form__row">
          <Field label="First date" hint={backfills ? "Past occurrences since this date will be recorded now." : "Sets the day it repeats on."}>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} required />
          </Field>
          <Field label="Ends" hint="Optional">
            <input className="input" type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </Field>
        </div>
        <div className="form__row">
          <Field label={kind === "transfer" ? "From account" : "Account"}>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          {kind === "transfer" ? (
            <Field label="To account">
              <select className="select" value={transferAccountId} onChange={(e) => setTransferAccountId(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </Field>
          ) : (
            <Field label="Category">
              <select className="select" value={categoryId} onChange={(e) => setCategoryId(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}
        </div>
        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="e.g. Apartment rent" required />
        </Field>
        {save.error && <p className="form-error" role="alert">{save.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={save.busy}>Cancel</button>
          <button className="button button--primary" disabled={save.busy || amount === null || amount <= 0}>{save.busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}
