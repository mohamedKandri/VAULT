import { useState } from "react";
import { api, type TransactionInput } from "../../data/api";
import { useLedger } from "../../data/LedgerContext";
import { formatMAD, type Transaction, type TransactionKind } from "../../engine";
import { AmountField, Dialog, Field, Segmented, readAmount, useSubmit } from "../../ui/forms";

/** Create (`transaction` = null) or edit a transaction. */
export function TransactionDialog(props: { transaction: Transaction | null; onClose: () => void }) {
  const { ledger, today, mutate } = useLedger();
  const editing = props.transaction;
  const accounts = ledger.accounts.filter((a) => !a.archived || a.id === editing?.accountId || a.id === editing?.transferAccountId);

  const [kind, setKind] = useState<TransactionKind>(editing?.kind ?? "expense");
  const [amountText, setAmountText] = useState(editing ? formatMAD(editing.amount, { code: false }) : "");
  const [date, setDate] = useState(editing?.date ?? today);
  const [accountId, setAccountId] = useState(editing?.accountId ?? accounts[0]?.id ?? "");
  const [transferAccountId, setTransferAccountId] = useState(editing?.transferAccountId ?? "");
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? "");
  const [description, setDescription] = useState(editing?.description ?? "");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [isFixed, setFixed] = useState(editing?.isFixed ?? false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const categories = ledger.categories.filter((c) => c.kind === kind && (!c.archived || c.id === editing?.categoryId));
  const amount = readAmount(amountText).value;

  const changeKind = (next: TransactionKind) => {
    setKind(next);
    setCategoryId("");
    setFixed(false);
  };
  const changeCategory = (id: string) => {
    setCategoryId(id);
    // New expenses inherit the category's default; an explicit choice on an existing one is kept.
    if (!editing) setFixed(ledger.categories.find((c) => c.id === id)?.isFixedDefault ?? false);
  };

  const save = useSubmit(async () => {
    if (amount === null || amount <= 0) throw new Error("Enter an amount greater than zero.");
    const input: TransactionInput = {
      accountId,
      date,
      kind,
      amount,
      categoryId: kind === "transfer" ? null : categoryId || null,
      transferAccountId: kind === "transfer" ? transferAccountId || null : null,
      description,
      notes,
      isFixed: kind === "expense" && isFixed,
    };
    await mutate(() => api.saveTransaction(editing?.id ?? null, input));
    props.onClose();
  });
  const remove = useSubmit(async () => {
    await mutate(() => api.deleteTransaction(editing!.id));
    props.onClose();
  });
  const busy = save.busy || remove.busy;

  return (
    <Dialog title={editing ? "Edit transaction" : "New transaction"} onClose={props.onClose}>
      <form className="form" onSubmit={save.submit}>
        <Segmented
          label="Type"
          value={kind}
          onChange={changeKind}
          options={[
            { value: "expense", label: "Expense" },
            { value: "income", label: "Income" },
            { value: "transfer", label: "Transfer" },
          ]}
        />

        <div className="form__row">
          <AmountField label="Amount" text={amountText} onChange={setAmountText} autoFocus={!editing} />
          <Field label="Date">
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
          </Field>
        </div>

        <div className="form__row">
          <Field label={kind === "transfer" ? "From account" : "Account"}>
            <select className="select" value={accountId} onChange={(e) => setAccountId(e.target.value)} required>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </Field>
          {kind === "transfer" ? (
            <Field label="To account">
              <select className="select" value={transferAccountId} onChange={(e) => setTransferAccountId(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {accounts.filter((a) => a.id !== accountId).map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </Field>
          ) : (
            <Field label="Category">
              <select className="select" value={categoryId} onChange={(e) => changeCategory(e.target.value)} required>
                <option value="" disabled>Choose…</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <Field label="Description">
          <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} placeholder="Optional" />
        </Field>
        <Field label="Notes">
          <textarea className="textarea" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Optional" rows={2} />
        </Field>

        {kind === "expense" && (
          <label className="check">
            <input type="checkbox" checked={isFixed} onChange={(e) => setFixed(e.target.checked)} />
            <span>Fixed expense (a commitment such as rent or a bill)</span>
          </label>
        )}

        {(save.error || remove.error) && <p className="form-error" role="alert">{save.error ?? remove.error}</p>}

        <div className="form__actions">
          {editing &&
            (confirmDelete ? (
              <button type="button" className="button button--danger" onClick={() => remove.submit()} disabled={busy}>
                Confirm delete
              </button>
            ) : (
              <button type="button" className="button button--danger" onClick={() => setConfirmDelete(true)} disabled={busy}>
                Delete
              </button>
            ))}
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={busy}>
            Cancel
          </button>
          <button className="button button--primary" disabled={busy || amount === null || amount <= 0}>
            {save.busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
