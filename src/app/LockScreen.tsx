import { useState } from "react";
import { useLedger } from "../data/LedgerContext";
import { Field, useSubmit } from "../ui/forms";
import "./lock.css";

const MIN_LENGTH = 8;

/** Shown instead of the app while the vault is locked or does not exist yet. */
export function LockScreen({ mode }: { mode: "setup" | "locked" }) {
  const { create, unlock } = useLedger();
  const [passphrase, setPassphrase] = useState("");
  const [confirm, setConfirm] = useState("");
  const [understood, setUnderstood] = useState(false);

  const setup = mode === "setup";
  const tooShort = setup && passphrase.length > 0 && passphrase.length < MIN_LENGTH;
  const mismatch = setup && confirm.length > 0 && confirm !== passphrase;
  const ready = setup
    ? passphrase.length >= MIN_LENGTH && confirm === passphrase && understood
    : passphrase.length > 0;

  const { busy, error, submit } = useSubmit(async () => {
    try {
      await (setup ? create(passphrase) : unlock(passphrase));
    } finally {
      setPassphrase("");
      setConfirm("");
    }
  });

  return (
    <div className="lock">
      <form className="lock__card" onSubmit={submit}>
        <div className="brand lock__brand" aria-label="VAULT">
          <span className="brand__mark" aria-hidden />
          <span className="brand__name">VAULT</span>
        </div>

        <h1 className="lock__title">{setup ? "Create your vault" : "Unlock"}</h1>
        <p className="lock__lead">
          {setup
            ? "Your records are encrypted on this computer with a passphrase only you know."
            : "Enter your passphrase to decrypt your records."}
        </p>

        <Field label="Passphrase" error={tooShort ? `At least ${MIN_LENGTH} characters` : null}>
          <input
            className="input"
            type="password"
            value={passphrase}
            onChange={(e) => setPassphrase(e.target.value)}
            autoFocus
            autoComplete={setup ? "new-password" : "current-password"}
            disabled={busy}
          />
        </Field>

        {setup && (
          <>
            <Field label="Repeat passphrase" error={mismatch ? "The two entries differ" : null}>
              <input
                className="input"
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                disabled={busy}
              />
            </Field>
            <label className="check lock__warning">
              <input type="checkbox" checked={understood} onChange={(e) => setUnderstood(e.target.checked)} />
              <span>
                I understand there is no recovery. If I forget this passphrase, my data cannot be read by anyone,
                including me.
              </span>
            </label>
          </>
        )}

        {error && <p className="form-error" role="alert">{error}</p>}

        <button className="button button--primary lock__submit" disabled={!ready || busy}>
          {busy ? (setup ? "Creating…" : "Unlocking…") : setup ? "Create vault" : "Unlock"}
        </button>

        <p className="lock__foot">
          {setup
            ? "Argon2id key derivation, XChaCha20-Poly1305 encryption. Nothing is sent anywhere."
            : "Locks automatically after 10 minutes of inactivity."}
        </p>
      </form>
    </div>
  );
}
