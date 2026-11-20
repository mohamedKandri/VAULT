import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import type { ReactNode } from "react";
import { formatBps, formatMAD, type Centimes } from "../engine";
import "./primitives.css";

/** A titled surface. `pending` marks a module that is not built yet. */
export function Panel(props: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  pending?: boolean;
}) {
  return (
    <section className={`panel ${props.pending ? "panel--pending" : ""} ${props.className ?? ""}`}>
      <header className="panel__head">
        <h2 className="panel__title">{props.title}</h2>
        {props.aside && <div className="panel__aside">{props.aside}</div>}
      </header>
      {props.children}
    </section>
  );
}

/**
 * An amount with typographic hierarchy: quiet currency code, strong whole
 * part, quiet centimes. Null renders as an em dash - unknown is never "0".
 */
export function Money(props: { amount: Centimes | null; size?: "hero" | "figure" | "body"; signed?: boolean }) {
  const size = props.size ?? "body";
  if (props.amount === null) {
    return <span className={`money money--${size} money--unknown`}>—</span>;
  }
  const text = formatMAD(props.amount, { code: false, signed: props.signed });
  const [whole, fraction] = text.split(".");
  return (
    <span className={`money money--${size}`} data-figure>
      <span className="money__code">MAD</span>
      <span className="money__whole">{whole}</span>
      <span className="money__fraction">.{fraction}</span>
    </span>
  );
}

/**
 * A signed change with an arrow and a named comparison period.
 * `goodWhen` says which direction is good news, so rising expenses read as
 * a warning and rising income as positive.
 */
export function Delta(props: {
  amount?: Centimes | null;
  bps?: number | null;
  /** With `bps`: "percent" for a relative change, "points" for a difference between two rates. */
  unit?: "percent" | "points";
  goodWhen: "up" | "down";
  versus: string;
}) {
  const value = props.amount ?? props.bps ?? null;
  if (value === null) return <span className="delta delta--flat">No comparison yet</span>;
  const direction = value === 0 ? "flat" : value > 0 ? "up" : "down";
  const tone = direction === "flat" ? "flat" : direction === props.goodWhen ? "good" : "bad";
  const Icon = direction === "flat" ? Minus : direction === "up" ? ArrowUpRight : ArrowDownRight;
  const text =
    props.amount != null
      ? formatMAD(props.amount, { signed: true, decimals: "auto" })
      : props.unit === "points"
        ? `${formatBps(props.bps as number, { signed: true }).replace("%", "")} pts`
        : formatBps(props.bps as number, { signed: true });
  return (
    <span className={`delta delta--${tone}`}>
      <Icon size={13} strokeWidth={2} aria-hidden />
      <span className="tnum">{text}</span>
      <span className="delta__versus">{props.versus}</span>
    </span>
  );
}

export function Tag(props: { tone?: "neutral" | "caution" | "positive"; children: ReactNode }) {
  return <span className={`tag tag--${props.tone ?? "neutral"}`}>{props.children}</span>;
}

/** Legend key: a coloured mark beside ink-coloured text. */
export function LegendKey(props: { color: string; label: string; shape?: "square" | "line" }) {
  return (
    <span className="legend-key">
      <span className={`legend-key__mark legend-key__mark--${props.shape ?? "square"}`} style={{ background: props.color }} />
      {props.label}
    </span>
  );
}

/** Twelve-point trend line. The latest point is marked; nulls break the line. */
export function Sparkline(props: { values: (number | null)[]; label: string }) {
  const width = 96;
  const height = 28;
  const pad = 4;
  const known = props.values.filter((v): v is number => v !== null);
  if (known.length < 2) return <span className="sparkline sparkline--empty" aria-hidden />;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min || 1;
  const step = (width - pad * 2) / (props.values.length - 1);
  const point = (v: number, i: number) => [pad + i * step, height - pad - ((v - min) / span) * (height - pad * 2)] as const;

  let path = "";
  let pen = false;
  props.values.forEach((v, i) => {
    if (v === null) {
      pen = false;
      return;
    }
    const [x, y] = point(v, i);
    path += `${pen ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    pen = true;
  });
  const lastIndex = props.values.length - 1;
  const last = props.values[lastIndex];
  return (
    <svg className="sparkline" width={width} height={height} role="img" aria-label={props.label}>
      <path d={path} fill="none" stroke="var(--series-neutral)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      {last !== null && (
        <circle cx={point(last, lastIndex)[0]} cy={point(last, lastIndex)[1]} r={3} fill="var(--text-1)" stroke="var(--surface-1)" strokeWidth={2} />
      )}
    </svg>
  );
}
