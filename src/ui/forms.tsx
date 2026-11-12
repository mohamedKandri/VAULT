import { X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { MoneyError, dirhams, formatMAD, parseAmount, type Centimes } from "../engine";
import "./forms.css";

/** Modal built on the native <dialog>: focus trap and Esc come for free. */
export function Dialog(props: { title: string; onClose: () => void; children: ReactNode; width?: number }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      style={{ width: props.width ?? 460 }}
      onCancel={(event) => {
        event.preventDefault();
        props.onClose();
      }}
    >
      <header className="dialog__head">
        <h2>{props.title}</h2>
        <button className="icon-button" onClick={props.onClose} aria-label="Close" type="button">
          <X size={16} />
        </button>
      </header>
      {props.children}
    </dialog>
  );
}

export function Field(props: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field__label">{props.label}</span>
      {props.children}
      {props.error ? <span className="field__error">{props.error}</span> : props.hint ? <span className="field__hint">{props.hint}</span> : null}
    </label>
  );
}

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={props.label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={option.value === props.value}
          className={option.value === props.value ? "is-on" : ""}
          onClick={() => props.onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** Parse amount text, returning the value or the reason it was rejected. */
export function readAmount(text: string): { value: Centimes | null; error: string | null } {
  if (text.trim() === "") return { value: null, error: null };
  try {
    return { value: parseAmount(text), error: null };
  } catch (error) {
    return { value: null, error: error instanceof MoneyError ? "Enter an amount such as 1500 or 1,500.50" : String(error) };
  }
}

/**
 * Amount entry. The text is parsed without floating point, and the value as
 * understood is echoed underneath so "1.500" is never silently misread.
 */
export function AmountField(props: {
  label: string;
  text: string;
  onChange: (text: string) => void;
  allowNegative?: boolean;
  autoFocus?: boolean;
}) {
  const { value, error } = readAmount(props.text);
  const negative = value !== null && value < 0 && !props.allowNegative;
  return (
    <Field
      label={props.label}
      error={negative ? "Enter a positive amount" : error}
      hint={value !== null ? <>Read as <b className="tnum">{formatMAD(value)}</b></> : "In dirhams"}
    >
      <input
        className="input tnum"
        inputMode="decimal"
        value={props.text}
        onChange={(event) => props.onChange(event.target.value)}
        placeholder="0.00"
        autoFocus={props.autoFocus}
        autoComplete="off"
      />
    </Field>
  );
}

/** Wraps an async submit: disables the form while it runs and shows a failure. */
export function useSubmit(action: () => Promise<void>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, submit, setError };
}

/**
 * Amount input bound to a Centimes value, with an optional slider for quick
 * what-if changes. While focused it keeps the text as typed; otherwise it
 * shows the formatted value. Invalid text leaves the last valid value in place.
 */
export function MoneyInput(props: {
  label: string;
  value: Centimes;
  onChange: (value: Centimes) => void;
  /** Slider upper bound in whole dirhams; omit for no slider. */
  sliderMax?: number;
  step?: number;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const shown = draft ?? formatMAD(props.value, { code: false, decimals: "auto" });
  const { error } = draft === null ? { error: null } : readAmount(draft);
  const whole = Math.round(props.value / 100);
  return (
    <Field label={props.label} hint={props.hint} error={error}>
      <input
        className="input tnum"
        inputMode="decimal"
        value={shown}
        disabled={props.disabled}
        onFocus={() => setDraft(formatMAD(props.value, { code: false, decimals: "auto" }).replace(/,/g, ""))}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = readAmount(event.target.value).value;
          if (parsed !== null && parsed >= 0) props.onChange(parsed);
        }}
        onBlur={() => setDraft(null)}
        autoComplete="off"
      />
      {props.sliderMax !== undefined && (
        <input
          className="slider"
          type="range"
          min={0}
          max={Math.max(props.sliderMax, whole)}
          step={props.step ?? 100}
          value={whole}
          disabled={props.disabled}
          aria-label={`${props.label} slider`}
          onChange={(event) => props.onChange(dirhams(Number(event.target.value)))}
        />
      )}
    </Field>
  );
}
