/**
 * Time-series chart over months, drawn in SVG with no chart library.
 *
 *   columns  one thin column per series per month, from a zero baseline
 *   signed   one column per month, above or below zero, coloured by sign
 *   lines    2px lines with a soft wash under the first series
 *
 * One y-axis, always including zero. Hovering (or focusing and using the
 * arrow keys) shows every series for that month; a hidden table carries the
 * same data for screen readers.
 */

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { formatMAD, type Centimes } from "../../engine";
import { axisAmount } from "../format";
import "./charts.css";

export interface ChartMonth {
  key: string;
  /** Short axis label, e.g. "Nov". */
  label: string;
  /** Full label for the tooltip, e.g. "November 2026". */
  title: string;
  /** Month still in progress: drawn lighter and labelled "to date". */
  partial?: boolean;
}

export interface ChartSeries {
  name: string;
  color: string;
  /** Centimes per month; null = unknown (no mark is drawn). */
  values: (Centimes | null)[];
}

interface Props {
  kind: "columns" | "signed" | "lines";
  months: ChartMonth[];
  series: ChartSeries[];
  height?: number;
  /** Accessible summary of what the chart shows. */
  label: string;
  /** Horizontal reference line, e.g. a savings target. */
  reference?: { value: Centimes; label: string } | null;
}

const MARGIN = { top: 10, right: 12, bottom: 24, left: 46 };

function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** Round axis bounds and ticks (1 / 2 / 2.5 / 5 x 10^n steps). */
export function niceScale(min: number, max: number, target = 4) {
  if (max <= min) max = min + 1;
  const rough = (max - min) / target;
  const power = 10 ** Math.floor(Math.log10(rough));
  const fraction = rough / power;
  const step = (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 2.5 ? 2.5 : fraction <= 5 ? 5 : 10) * power;
  const low = Math.floor(min / step) * step;
  const high = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let t = low; t <= high + step / 2; t += step) ticks.push(Math.round(t));
  return { low, high, ticks };
}

/** Column with a 4px rounded data end and a square end on the baseline. */
function columnPath(x: number, baseline: number, width: number, end: number) {
  const height = Math.abs(end - baseline);
  if (height < 0.5) return "";
  const r = Math.min(4, width / 2, height);
  const dir = end < baseline ? 1 : -1; // 1 = grows upward
  return [
    `M${x},${baseline}`,
    `L${x},${end + dir * r}`,
    `Q${x},${end} ${x + r},${end}`,
    `L${x + width - r},${end}`,
    `Q${x + width},${end} ${x + width},${end + dir * r}`,
    `L${x + width},${baseline}`,
    "Z",
  ].join("");
}

export function MonthChart({ kind, months, series, height = 220, label, reference }: Props) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();

  const all = series.flatMap((s) => s.values).filter((v): v is Centimes => v !== null);
  if (reference) all.push(reference.value);
  const scale = niceScale(Math.min(0, ...all), Math.max(0, ...all));
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right);
  const plotHeight = height - MARGIN.top - MARGIN.bottom;
  const band = months.length > 0 ? plotWidth / months.length : 0;
  const y = (value: number) => MARGIN.top + plotHeight * (1 - (value - scale.low) / (scale.high - scale.low));
  const centre = (i: number) => MARGIN.left + band * (i + 0.5);
  const baseline = y(0);
  const labelEvery = Math.max(1, Math.ceil(34 / Math.max(band, 1)));

  const onKey = (event: KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const from = hover ?? months.length - 1;
    setHover(Math.min(months.length - 1, Math.max(0, from + (event.key === "ArrowRight" ? 1 : -1))));
  };

  const marks = () => {
    if (kind === "lines") {
      return series.map((s, si) => {
        const points = s.values.map((v, i) => (v === null ? null : ([centre(i), y(v)] as const)));
        let line = "";
        let pen = false;
        points.forEach((p) => {
          if (!p) return void (pen = false);
          line += `${pen ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`;
          pen = true;
        });
        const known = points.filter((p): p is readonly [number, number] => p !== null);
        const area =
          si === 0 && known.length > 1 && known.length === points.length
            ? `${line}L${known[known.length - 1][0].toFixed(1)},${baseline}L${known[0][0].toFixed(1)},${baseline}Z`
            : "";
        const end = known[known.length - 1];
        return (
          <g key={s.name}>
            {area && <path d={area} fill={s.color} opacity={0.1} />}
            <path d={line} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
            {end && <circle cx={end[0]} cy={end[1]} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />}
            {hover !== null && points[hover] && (
              <circle cx={points[hover]![0]} cy={points[hover]![1]} r={4} fill={s.color} stroke="var(--surface-1)" strokeWidth={2} />
            )}
          </g>
        );
      });
    }

    const count = kind === "signed" ? 1 : series.length;
    const gap = 2;
    const columnWidth = Math.max(2, Math.min(kind === "signed" ? 18 : 10, (band * 0.62 - gap * (count - 1)) / count));
    const groupWidth = columnWidth * count + gap * (count - 1);
    return months.map((month, i) => (
      <g key={month.key} opacity={month.partial ? 0.5 : 1}>
        {series.slice(0, count).map((s, si) => {
          const value = s.values[i];
          if (value === null) return null;
          const x = centre(i) - groupWidth / 2 + si * (columnWidth + gap);
          const fill = kind === "signed" ? (value < 0 ? "var(--negative)" : "var(--positive)") : s.color;
          return <path key={s.name} d={columnPath(x, baseline, columnWidth, y(value))} fill={fill} />;
        })}
      </g>
    ));
  };

  const hovered = hover !== null ? months[hover] : null;
  const tooltipLeft = hover !== null ? Math.min(Math.max(centre(hover), 96), Math.max(96, width - 96)) : 0;

  return (
    <div className="chart" ref={ref} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          role="img"
          aria-label={label}
          aria-describedby={tableId}
          tabIndex={0}
          onKeyDown={onKey}
          onBlur={() => setHover(null)}
          onPointerLeave={() => setHover(null)}
        >
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke={tick === 0 ? "var(--axis)" : "var(--grid)"} />
              <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" className="chart__tick">
                {axisAmount(tick as Centimes)}
              </text>
            </g>
          ))}
          {hover !== null && kind !== "lines" && (
            <rect x={MARGIN.left + band * hover} y={MARGIN.top} width={band} height={plotHeight} fill="var(--text-1)" opacity={0.04} />
          )}
          {hover !== null && kind === "lines" && (
            <line x1={centre(hover)} x2={centre(hover)} y1={MARGIN.top} y2={MARGIN.top + plotHeight} stroke="var(--hairline-strong)" />
          )}
          {marks()}
          {reference && (
            <g>
              <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(reference.value)} y2={y(reference.value)} stroke="var(--text-3)" />
              <text x={width - MARGIN.right} y={y(reference.value) - 6} textAnchor="end" className="chart__tick chart__tick--on">
                {reference.label}
              </text>
            </g>
          )}
          {months.map((month, i) =>
            (months.length - 1 - i) % labelEvery === 0 ? (
              <text key={month.key} x={centre(i)} y={height - 6} textAnchor="middle" className={`chart__tick ${hover === i ? "chart__tick--on" : ""}`}>
                {month.label}
              </text>
            ) : null,
          )}
          {months.map((month, i) => (
            <rect
              key={month.key}
              x={MARGIN.left + band * i}
              y={0}
              width={band}
              height={height}
              fill="transparent"
              onPointerEnter={() => setHover(i)}
              onPointerMove={() => setHover(i)}
            />
          ))}
        </svg>
      )}

      {hovered && hover !== null && (
        <div className="chart__tooltip" style={{ left: tooltipLeft }} role="status">
          <div className="chart__tooltip-title">
            {hovered.title}
            {hovered.partial && <span> · to date</span>}
          </div>
          {series.map((s) => {
            const value = s.values[hover];
            const color = kind === "signed" ? (value !== null && value < 0 ? "var(--negative)" : "var(--positive)") : s.color;
            return (
              <div className="chart__tooltip-row" key={s.name}>
                <span className="chart__swatch" style={{ background: color }} />
                <span>{s.name}</span>
                <span className="tnum chart__tooltip-value">
                  {value === null ? "—" : formatMAD(value, { signed: kind === "signed" })}
                </span>
              </div>
            );
          })}
        </div>
      )}

      <div className="sr-only">
      <table id={tableId}>
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            {series.map((s) => (
              <th scope="col" key={s.name}>{s.name}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((month, i) => (
            <tr key={month.key}>
              <th scope="row">{month.title}{month.partial ? " (to date)" : ""}</th>
              {series.map((s) => (
                <td key={s.name}>{s.values[i] === null ? "unknown" : formatMAD(s.values[i] as Centimes)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </div>
  );
}
