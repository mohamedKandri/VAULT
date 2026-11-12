import { Download, FileUp, HardDriveDownload, HardDriveUpload, Trash2 } from "lucide-react";
import { useState } from "react";
import { api } from "../../data/api";
import { useLedger } from "../../data/LedgerContext";
import type { LedgerAccount } from "../../data/ledger";
import { accountBalance, formatMAD, negate, sub, type Centimes } from "../../engine";
import { AmountField, Dialog, Field, readAmount, useSubmit } from "../../ui/forms";
import { Panel } from "../../ui/primitives";
import { planImport, resolveImport, type ImportPlan } from "./csvImport";

type Modal =
  | { kind: "import"; fileName: string; plan: ImportPlan }
  | { kind: "json" }
  | { kind: "restore" }
  | { kind: "destroy" }
  | null;

/** Import, export, backup, restore and deletion of the user's data. */
export function DataPanel() {
  const { ledger } = useLedger();
  const [modal, setModal] = useState<Modal>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (action: () => Promise<string | null | void>) => async () => {
    setError(null);
    setMessage(null);
    try {
      const result = await action();
      if (typeof result === "string") setMessage(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const saved = (what: string) => (name: string | null) => (name ? `${what} saved as ${name}.` : null);

  const pickCsv = run(async () => {
    const file = await api.pickCsv();
    if (file) setModal({ kind: "import", fileName: file.fileName, plan: planImport(file.headers, file.rows, ledger) });
  });

  return (
    <Panel title="Your data">
      <div className="data__grid">
        <Action icon={<FileUp size={16} />} title="Import transactions" text="From a CSV file. You review what will be added before anything changes." button="Choose file…" onClick={pickCsv} />
        <Action icon={<Download size={16} />} title="Export transactions" text="All transactions as a CSV file for a spreadsheet. Not encrypted." button="Export CSV…" onClick={run(async () => saved("Transactions")(await api.exportCsv()))} />
        <Action icon={<HardDriveDownload size={16} />} title="Back up" text="An encrypted copy of everything, protected by your current passphrase. Keep it somewhere else." button="Save backup…" onClick={run(async () => saved("Backup")(await api.exportBackup()))} />
        <Action icon={<HardDriveUpload size={16} />} title="Restore" text="Replace everything here with a backup file. The current vault is kept beside it." button="Restore…" onClick={() => setModal({ kind: "restore" })} />
        <Action icon={<Download size={16} />} title="Export everything" text="Accounts, categories, transactions, recurring items and goals as readable JSON. Not encrypted." button="Export JSON…" onClick={() => setModal({ kind: "json" })} />
        <Action icon={<Trash2 size={16} />} title="Delete everything" text="Permanently erase the vault from this computer. This cannot be undone." button="Delete…" danger onClick={() => setModal({ kind: "destroy" })} />
      </div>
      <p className="settings__hint">
        Import columns: <b>date</b>, <b>type</b> (income, expense, transfer), <b>amount</b>, and optionally category, account,
        to_account, description, notes, fixed. An exported file can be imported back as is.
      </p>
      {message && <p className="settings__ok" role="status">{message}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}

      {modal?.kind === "import" && <ImportDialog fileName={modal.fileName} plan={modal.plan} onClose={() => setModal(null)} onDone={setMessage} />}
      {modal?.kind === "json" && (
        <ConfirmDialog
          title="Export everything, unencrypted?"
          body="The file will contain all your financial records in plain, readable text. Anyone who gets the file can read it. Store it carefully and delete it when you no longer need it."
          confirm="Choose where to save…"
          onClose={() => setModal(null)}
          onConfirm={async () => setMessage(saved("Export")(await api.exportJson()))}
        />
      )}
      {modal?.kind === "restore" && <RestoreDialog onClose={() => setModal(null)} onDone={setMessage} />}
      {modal?.kind === "destroy" && <DestroyDialog onClose={() => setModal(null)} />}
    </Panel>
  );
}

function Action(props: { icon: React.ReactNode; title: string; text: string; button: string; onClick: () => void; danger?: boolean }) {
  return (
    <div className="data__action">
      <span className="data__icon" aria-hidden>{props.icon}</span>
      <div>
        <h3>{props.title}</h3>
        <p>{props.text}</p>
      </div>
      <button className={`button ${props.danger ? "button--danger" : "button--plain"}`} onClick={props.onClick}>{props.button}</button>
    </div>
  );
}

function ConfirmDialog(props: { title: string; body: string; confirm: string; onClose: () => void; onConfirm: () => Promise<void> }) {
  const go = useSubmit(async () => {
    await props.onConfirm();
    props.onClose();
  });
  return (
    <Dialog title={props.title} onClose={props.onClose}>
      <form className="form" onSubmit={go.submit}>
        <p className="dialog__text">{props.body}</p>
        {go.error && <p className="form-error" role="alert">{go.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={go.busy}>Cancel</button>
          <button className="button button--primary" disabled={go.busy}>{props.confirm}</button>
        </div>
      </form>
    </Dialog>
  );
}

function ImportDialog(props: { fileName: string; plan: ImportPlan; onClose: () => void; onDone: (message: string) => void }) {
  const { mutate } = useLedger();
  const { plan } = props;
  const go = useSubmit(async () => {
    // Categories first, so the rows that use them can refer to real ids; then all rows in one step.
    for (const category of plan.newCategories) {
      await api.saveCategory(null, { name: category.name, kind: category.kind, isFixedDefault: false });
    }
    const fresh = await api.loadLedger();
    const count = await mutate(() => api.importTransactions(resolveImport(plan.rows, fresh)));
    props.onDone(`${count} transactions imported from ${props.fileName}.`);
    props.onClose();
  });
  return (
    <Dialog title={`Import from ${props.fileName}`} onClose={props.onClose} width={520}>
      <form className="form" onSubmit={go.submit}>
        <dl className="import__summary">
          <div><dt>Will be added</dt><dd className="tnum">{plan.rows.length}</dd></div>
          <div><dt>Already recorded, skipped</dt><dd className="tnum">{plan.duplicates}</dd></div>
          <div><dt>Could not be read</dt><dd className="tnum">{plan.errors.length}</dd></div>
        </dl>
        {plan.newCategories.length > 0 && (
          <p className="dialog__text">New categories will be created: {plan.newCategories.map((c) => c.name).join(", ")}.</p>
        )}
        {plan.errors.length > 0 && (
          <ul className="import__errors">
            {plan.errors.slice(0, 8).map((e) => <li key={e.line}><b>Line {e.line}:</b> {e.message}</li>)}
            {plan.errors.length > 8 && <li>…and {plan.errors.length - 8} more.</li>}
          </ul>
        )}
        {plan.errors.length > 0 && plan.rows.length > 0 && <p className="dialog__text">Unreadable lines are left out. You can fix the file and import it again: rows already added are skipped.</p>}
        {go.error && <p className="form-error" role="alert">{go.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={go.busy}>Cancel</button>
          <button className="button button--primary" disabled={go.busy || plan.rows.length === 0}>
            {go.busy ? "Importing…" : `Import ${plan.rows.length} transactions`}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function RestoreDialog(props: { onClose: () => void; onDone: (message: string) => void }) {
  const { refresh } = useLedger();
  const [passphrase, setPassphrase] = useState("");
  const go = useSubmit(async () => {
    try {
      const name = await api.restoreBackup(passphrase);
      if (name) {
        await refresh();
        props.onDone(`Restored from ${name}. Your passphrase is now the one that protected that backup.`);
        props.onClose();
      }
    } finally {
      setPassphrase("");
    }
  });
  return (
    <Dialog title="Restore from a backup" onClose={props.onClose}>
      <form className="form" onSubmit={go.submit}>
        <p className="dialog__text">
          Everything currently in VAULT will be replaced by the contents of the backup. The backup is checked completely
          before anything changes, and the current vault file is kept next to the new one.
        </p>
        <Field label="Passphrase of the backup" hint="The passphrase VAULT had when the backup was made.">
          <input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoFocus autoComplete="off" />
        </Field>
        {go.error && <p className="form-error" role="alert">{go.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={go.busy}>Cancel</button>
          <button className="button button--primary" disabled={go.busy || !passphrase}>{go.busy ? "Restoring…" : "Choose backup file…"}</button>
        </div>
      </form>
    </Dialog>
  );
}

function DestroyDialog(props: { onClose: () => void }) {
  const { forget } = useLedger();
  const [passphrase, setPassphrase] = useState("");
  const [typed, setTyped] = useState("");
  const go = useSubmit(async () => {
    try {
      await api.destroyVault(passphrase);
      forget();
    } finally {
      setPassphrase("");
    }
  });
  return (
    <Dialog title="Delete everything" onClose={props.onClose}>
      <form className="form" onSubmit={go.submit}>
        <p className="dialog__text">
          This erases the vault file, the copy kept from a previous restore, and all records in it from this computer.
          Backups you saved elsewhere are not touched. It cannot be undone.
        </p>
        <Field label="Your passphrase">
          <input className="input" type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoFocus autoComplete="off" />
        </Field>
        <Field label='Type DELETE to confirm'>
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        </Field>
        {go.error && <p className="form-error" role="alert">{go.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={go.busy}>Cancel</button>
          <button className="button button--danger" disabled={go.busy || !passphrase || typed !== "DELETE"}>{go.busy ? "Deleting…" : "Delete everything"}</button>
        </div>
      </form>
    </Dialog>
  );
}

/**
 * Compare the balance VAULT calculates with the real one. If they differ, the
 * gap can be recorded as an adjustment so the two agree from today on.
 */
export function ReconcileDialog(props: { account: LedgerAccount; onClose: () => void }) {
  const { ledger, today, mutate } = useLedger();
  const [text, setText] = useState("");
  const calculated = accountBalance(props.account, ledger.transactions, today);
  const real = readAmount(text).value;
  const gap: Centimes | null = real !== null && calculated !== null ? sub(real, calculated) : null;

  const go = useSubmit(async () => {
    if (gap === null || gap === 0) return props.onClose();
    const kind = gap > 0 ? "income" : "expense";
    const names = kind === "income" ? ["additional income", "other"] : ["other"];
    const category =
      ledger.categories.find((c) => c.kind === kind && !c.archived && names.includes(c.name.toLowerCase())) ??
      ledger.categories.find((c) => c.kind === kind && !c.archived);
    if (!category) throw new Error(`Add an ${kind} category first, to file the adjustment under.`);
    await mutate(() =>
      api.saveTransaction(null, {
        accountId: props.account.id, date: today, kind, amount: gap > 0 ? gap : negate(gap), categoryId: category.id,
        transferAccountId: null, description: "Balance adjustment",
        notes: `Reconciliation: calculated ${formatMAD(calculated!)}, real ${formatMAD(real!)}.`, isFixed: false,
      }),
    );
    props.onClose();
  });

  return (
    <Dialog title={`Reconcile ${props.account.name}`} onClose={props.onClose}>
      <form className="form" onSubmit={go.submit}>
        <p className="dialog__text">
          VAULT calculates <b className="tnum">{calculated === null ? "no balance yet" : formatMAD(calculated)}</b> from the opening
          balance and your records. Enter what the account really holds today.
        </p>
        <AmountField label="Real balance today" text={text} onChange={setText} allowNegative autoFocus />
        {gap !== null && (
          <p className="dialog__text" role="status">
            {gap === 0
              ? "They match. Nothing to adjust."
              : `The real balance is ${formatMAD(gap > 0 ? gap : negate(gap))} ${gap > 0 ? "higher" : "lower"} than calculated, usually because of ${gap > 0 ? "income" : "spending"} that was not recorded. Recording an adjustment adds one ${gap > 0 ? "income" : "expense"} entry for that amount, dated today.`}
          </p>
        )}
        {go.error && <p className="form-error" role="alert">{go.error}</p>}
        <div className="form__actions">
          <span className="spacer" />
          <button type="button" className="button button--plain" onClick={props.onClose} disabled={go.busy}>Cancel</button>
          <button className="button button--primary" disabled={go.busy || gap === null || gap === 0}>{go.busy ? "Saving…" : "Record adjustment"}</button>
        </div>
      </form>
    </Dialog>
  );
}
