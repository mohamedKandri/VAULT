import { Archive, ArchiveRestore, Lock, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../data/api";
import { useLedger } from "../../data/LedgerContext";
import type { Category, LedgerAccount } from "../../data/ledger";
import { accountBalance, formatMAD, type AccountKind } from "../../engine";
import { AmountField, Dialog, Field, Segmented, readAmount, useSubmit } from "../../ui/forms";
import { fullDate } from "../../ui/format";
import { Money, Panel } from "../../ui/primitives";
import "./settings.css";

const KIND_LABEL: Record<AccountKind, string> = { current: "Current", savings: "Savings", cash: "Cash" };

export function Settings() {
  const { status, isDemo } = useLedger();
  if (status !== "ready" || isDemo) {
    return (
      <div className="settings__note">
        <h2>{isDemo ? "Demo mode" : "No vault available"}</h2>
        <p>
          {isDemo
            ? "Settings change your real records, so they are unavailable while demo data is shown. Exit demo mode to manage accounts, categories and security."
            : "The interface is running without its storage backend. Start the desktop application to create a vault."}
        </p>
      </div>
    );
  }
  return (
    <div className="settings">
      <Accounts />
      <Categories />
      <Security />
    </div>
  );
}

function Accounts() {
  const { ledger, today, mutate } = useLedger();
  const [dialog, setDialog] = useState<{ account: LedgerAccount | null } | null>(null);
  const action = useSubmit(async () => {});

  const run = (change: () => Promise<unknown>) => async () => {
    action.setError(null);
    try {
      await mutate(change);
    } catch (e) {
      action.setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <Panel
      title="Accounts"
      aside={
        <button className="button button--quiet" onClick={() => setDialog({ account: null })}>
          <Plus size={13} /> Add account
        </button>
      }
    >
      {ledger.accounts.length === 0 ? (
        <p className="settings__empty">
          No accounts yet. Add the account your salary arrives in, with its balance as of today or of the day you want to
          start tracking from.
        </p>
      ) : (
        <ul className="settings__list">
          {ledger.accounts.map((account) => {
            const used = ledger.transactions.some((t) => t.accountId === account.id || t.transferAccountId === account.id);
            return (
              <li key={account.id} className={account.archived ? "is-archived" : ""}>
                <div className="settings__main">
                  <span className="settings__name">{account.name}</span>
                  <span className="settings__meta">
                    {KIND_LABEL[account.kind]} · opened {fullDate(account.openingDate)} with {formatMAD(account.openingBalance)}
                    {account.archived && " · archived"}
                  </span>
                </div>
                <Money amount={accountBalance(account, ledger.transactions, today)} />
                <div className="settings__actions">
                  <button className="icon-button" onClick={() => setDialog({ account })} aria-label={`Edit ${account.name}`} title="Edit">
                    <Pencil size={14} />
                  </button>
                  <button
                    className="icon-button"
                    onClick={run(() => api.setAccountArchived(account.id, !account.archived))}
                    aria-label={account.archived ? `Restore ${account.name}` : `Archive ${account.name}`}
                    title={account.archived ? "Restore" : "Archive"}
                  >
                    {account.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}
                  </button>
                  <button
                    className="icon-button"
                    onClick={run(() => api.deleteAccount(account.id))}
                    disabled={used}
                    aria-label={`Delete ${account.name}`}
                    title={used ? "Has transactions: archive instead" : "Delete"}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {action.error && <p className="form-error" role="alert">{action.error}</p>}
      {dialog && <AccountDialog account={dialog.account} onClose={() => setDialog(null)} />}
    </Panel>
  );
}

function AccountDialog(props: { account: LedgerAccount | null; onClose: () => void }) {
  const { today, mutate } = useLedger();
  const editing = props.account;
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<AccountKind>(editing?.kind ?? "current");
  const [balanceText, setBalanceText] = useState(editing ? formatMAD(editing.openingBalance, { code: false }) : "");
  const [openingDate, setOpeningDate] = useState(editing?.openingDate ?? today);
  const balance = readAmount(balanceText).value;

  const save = useSubmit(async () => {
    if (balance === null) throw new Error("Enter the opening balance (0 if the account is empty).");
    await mutate(() => api.saveAccount(editing?.id ?? null, { name, kind, openingBalance: balance, openingDate }));
    props.onClose();
  });

  return (
    <Dialog title={editing ? "Edit account" : "New account"} onClose={props.onClose}>
      <form className="form" onSubmit={save.submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="e.g. Current account" autoFocus required />
        </Field>
        <Field label="Type" hint="Current and cash count as available money; savings are tracked separately.">
          <Segmented
            label="Account type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "current", label: "Current" },
              { value: "savings", label: "Savings" },
              { value: "cash", label: "Cash" },
            ]}
          />
        </Field>
        <div className="form__row">
          <AmountField label="Opening balance" text={balanceText} onChange={setBalanceText} allowNegative />
          <Field label="As of" hint="Transactions before this date do not affect the balance.">
            <input className="input" type="date" value={openingDate} onChange={(e) => setOpeningDate(e.target.value)} required />
          </Field>
        </div>
        {save.error && <p className="form-error" role="alert">{save.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={save.busy}>Cancel</button>
          <button className="button button--primary" disabled={save.busy || !name.trim() || balance === null}>
            {save.busy ? "Saving…" : "Save"}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function Categories() {
  const { ledger, mutate } = useLedger();
  const [dialog, setDialog] = useState<{ category: Category | null } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (category: Category) => {
    setError(null);
    try {
      await mutate(() => api.setCategoryArchived(category.id, !category.archived));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const group = (kind: Category["kind"], title: string) => (
    <div className="settings__group">
      <h3>{title}</h3>
      <ul className="settings__chips">
        {ledger.categories.filter((c) => c.kind === kind).map((category) => (
          <li key={category.id} className={category.archived ? "is-archived" : ""}>
            <button className="settings__chip" onClick={() => setDialog({ category })} title="Edit">
              {category.name}
              {category.isFixedDefault && <span className="tx__fixed">Fixed</span>}
            </button>
            <button
              className="icon-button"
              onClick={() => toggle(category)}
              aria-label={category.archived ? `Restore ${category.name}` : `Archive ${category.name}`}
              title={category.archived ? "Restore" : "Archive"}
            >
              {category.archived ? <ArchiveRestore size={13} /> : <Archive size={13} />}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <Panel
      title="Categories"
      aside={
        <button className="button button--quiet" onClick={() => setDialog({ category: null })}>
          <Plus size={13} /> Add category
        </button>
      }
    >
      <div className="settings__groups">
        {group("expense", "Expenses")}
        {group("income", "Income")}
      </div>
      <p className="settings__hint">
        Archived categories are hidden when recording but stay on past transactions. Categories marked Fixed make new
        expenses count as fixed commitments by default.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
      {dialog && <CategoryDialog category={dialog.category} onClose={() => setDialog(null)} />}
    </Panel>
  );
}

function CategoryDialog(props: { category: Category | null; onClose: () => void }) {
  const { mutate } = useLedger();
  const editing = props.category;
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<Category["kind"]>(editing?.kind ?? "expense");
  const [isFixedDefault, setFixedDefault] = useState(editing?.isFixedDefault ?? false);

  const save = useSubmit(async () => {
    await mutate(() => api.saveCategory(editing?.id ?? null, { name, kind, isFixedDefault: kind === "expense" && isFixedDefault }));
    props.onClose();
  });

  return (
    <Dialog title={editing ? "Edit category" : "New category"} onClose={props.onClose} width={400}>
      <form className="form" onSubmit={save.submit}>
        <Field label="Name">
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} autoFocus required />
        </Field>
        {!editing && (
          <Segmented
            label="Category type"
            value={kind}
            onChange={setKind}
            options={[
              { value: "expense", label: "Expense" },
              { value: "income", label: "Income" },
            ]}
          />
        )}
        {kind === "expense" && (
          <label className="check">
            <input type="checkbox" checked={isFixedDefault} onChange={(e) => setFixedDefault(e.target.checked)} />
            <span>Fixed by default</span>
          </label>
        )}
        {save.error && <p className="form-error" role="alert">{save.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={save.busy}>Cancel</button>
          <button className="button button--primary" disabled={save.busy || !name.trim()}>{save.busy ? "Saving…" : "Save"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function Security() {
  const { lock } = useLedger();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);

  const change = useSubmit(async () => {
    setDone(false);
    try {
      await api.changePassphrase(current, next);
      setDone(true);
    } finally {
      setCurrent("");
      setNext("");
      setConfirm("");
    }
  });
  const ready = current.length > 0 && next.length >= 8 && next === confirm;

  return (
    <Panel
      title="Security"
      aside={
        <button className="button button--quiet" onClick={() => lock()}>
          <Lock size={13} /> Lock now
        </button>
      }
    >
      <p className="settings__hint settings__hint--top">
        Your records are stored in one encrypted file on this computer (Argon2id key derivation, XChaCha20-Poly1305).
        The decrypted database exists only in memory while VAULT is unlocked, and it locks after 10 minutes of
        inactivity. There is no passphrase recovery.
      </p>
      <form className="settings__passphrase" onSubmit={change.submit}>
        <Field label="Current passphrase">
          <input className="input" type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" />
        </Field>
        <Field label="New passphrase" error={next.length > 0 && next.length < 8 ? "At least 8 characters" : null}>
          <input className="input" type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Repeat new passphrase" error={confirm.length > 0 && confirm !== next ? "The two entries differ" : null}>
          <input className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />
        </Field>
        <button className="button button--plain" disabled={!ready || change.busy}>
          {change.busy ? "Re-encrypting…" : "Change passphrase"}
        </button>
      </form>
      {change.error && <p className="form-error" role="alert">{change.error}</p>}
      {done && <p className="settings__ok" role="status">Passphrase changed. The vault was re-encrypted with a new key.</p>}
    </Panel>
  );
}
