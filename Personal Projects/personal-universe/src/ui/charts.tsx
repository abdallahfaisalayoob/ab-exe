// Hand-built SVG charts. Small, fast, and styled by the same tokens as everything else.
import { ReactNode, useState } from "react";
import { useSize } from "../lib/hooks";

export function useTip() {
  const [tip, setTip] = useState<{ x: number; y: number; content: ReactNode } | null>(null);
  return {
    show: (e: { clientX: number; clientY: number }, content: ReactNode) => setTip({ x: e.clientX, y: e.clientY, content }),
    hide: () => setTip(null),
    node: tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.content}</div>,
  };
}

const nice = (max: number) => {
  if (max <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(max));
  const n = max / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
};

export interface Series { label: string; values: number[]; color: string; dashed?: boolean; fill?: boolean }

/** Line / area chart over evenly spaced categories, with a hover read-out. */
export function LineChart({ series, labels, height = 220, format = String, zero = true }: { series: Series[]; labels: string[]; height?: number; format?: (n: number) => string; zero?: boolean }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const tip = useTip();
  const pad = { l: 8, r: 8, t: 14, b: 24 };
  const all = series.flatMap((s) => s.values).filter(Number.isFinite);
  let lo = Math.min(...all, zero ? 0 : Infinity), hi = Math.max(...all, zero ? 0 : -Infinity);
  if (!all.length) { lo = 0; hi = 1; }
  if (hi === lo) { hi += 1; lo -= zero ? 0 : 1; }
  const span = hi - lo;
  hi += span * 0.08; if (lo < 0 || !zero) lo -= span * 0.08;
  const n = labels.length;
  const x = (i: number) => pad.l + (n <= 1 ? 0.5 : i / (n - 1)) * Math.max(1, w - pad.l - pad.r);
  const y = (v: number) => pad.t + (1 - (v - lo) / (hi - lo)) * (height - pad.t - pad.b);
  const path = (vals: number[]) => vals.map((v, i) => (Number.isFinite(v) ? `${i === 0 || !Number.isFinite(vals[i - 1]) ? "M" : "L"}${x(i).toFixed(1)},${y(v).toFixed(1)}` : "")).join("");
  const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 70))));
  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {w > 0 && (
        <svg className="chart" width={w} height={height} role="img"
          onMouseMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            const i = Math.max(0, Math.min(n - 1, Math.round(((e.clientX - r.left - pad.l) / Math.max(1, w - pad.l - pad.r)) * (n - 1))));
            setHover(i);
            tip.show({ clientX: r.left + x(i), clientY: r.top + Math.min(...series.map((s) => (Number.isFinite(s.values[i]) ? y(s.values[i]) : height))) }, (
              <div className="col gap1"><span className="faint">{labels[i]}</span>{series.filter((s) => Number.isFinite(s.values[i])).map((s) => <span key={s.label} className="row"><i className="dot" style={{ "--c": s.color } as any} />{s.label} <b className="num" style={{ marginLeft: "auto", paddingLeft: 12 }}>{format(s.values[i])}</b></span>)}</div>
            ));
          }}
          onMouseLeave={() => { setHover(null); tip.hide(); }}>
          <defs>{series.map((s, i) => <linearGradient key={i} id={`lg${i}-${s.color.replace(/\W/g, "")}`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor={s.color} stopOpacity=".28" /><stop offset="1" stopColor={s.color} stopOpacity="0" /></linearGradient>)}</defs>
          {[0.25, 0.5, 0.75].map((f) => <line key={f} className="grid" x1={pad.l} x2={w - pad.r} y1={pad.t + f * (height - pad.t - pad.b)} y2={pad.t + f * (height - pad.t - pad.b)} />)}
          {lo < 0 && <line className="axis" x1={pad.l} x2={w - pad.r} y1={y(0)} y2={y(0)} />}
          {series.map((s, i) => (
            <g key={s.label}>
              {s.fill !== false && !s.dashed && s.values.every(Number.isFinite) && n > 1 && <path d={`${path(s.values)}L${x(n - 1)},${y(Math.max(lo, 0))}L${x(0)},${y(Math.max(lo, 0))}Z`} fill={`url(#lg${i}-${s.color.replace(/\W/g, "")})`} />}
              <path d={path(s.values)} fill="none" stroke={s.color} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={s.dashed ? "3 5" : undefined} />
              {n === 1 && Number.isFinite(s.values[0]) && <circle cx={x(0)} cy={y(s.values[0])} r={3.5} fill={s.color} />}
            </g>
          ))}
          {hover != null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={height - pad.b} stroke="var(--line-2)" />}
          {hover != null && series.map((s) => Number.isFinite(s.values[hover]) && <circle key={s.label} cx={x(hover)} cy={y(s.values[hover])} r={4} fill="var(--bg)" stroke={s.color} strokeWidth={2} />)}
          {labels.map((l, i) => (i % step === 0 || i === n - 1) && (i === n - 1 || n - 1 - i >= step * 0.6) ? <text key={i} x={x(i)} y={height - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}>{l}</text> : null)}
          <text x={pad.l} y={10}>{format(hi - span * 0.08)}</text>
        </svg>
      )}
      {tip.node}
    </div>
  );
}

/** Paired bars per category (income vs spending). */
export function PairBars({ data, height = 220, colors, names, format = String }: { data: { label: string; a: number; b: number }[]; height?: number; colors: [string, string]; names: [string, string]; format?: (n: number) => string }) {
  const [ref, { w }] = useSize<HTMLDivElement>();
  const tip = useTip();
  const pad = { t: 14, b: 24 };
  const max = nice(Math.max(1, ...data.flatMap((d) => [d.a, d.b])));
  const band = w / Math.max(1, data.length), bw = Math.min(18, band * 0.28);
  const h = (v: number) => (v / max) * (height - pad.t - pad.b);
  return (
    <div ref={ref} style={{ width: "100%", height }}>
      {w > 0 && (
        <svg className="chart" width={w} height={height}>
          {[0, 0.5, 1].map((f) => <line key={f} className="grid" x1={0} x2={w} y1={pad.t + f * (height - pad.t - pad.b)} y2={pad.t + f * (height - pad.t - pad.b)} />)}
          <text x={0} y={10}>{format(max)}</text>
          {data.map((d, i) => {
            const cx = band * i + band / 2;
            return (
              <g key={d.label} onMouseMove={(e) => tip.show(e, <div className="col gap1"><span className="faint">{d.label}</span><span className="row"><i className="dot" style={{ "--c": colors[0] } as any} />{names[0]} <b className="num" style={{ marginLeft: "auto", paddingLeft: 12 }}>{format(d.a)}</b></span><span className="row"><i className="dot" style={{ "--c": colors[1] } as any} />{names[1]} <b className="num" style={{ marginLeft: "auto", paddingLeft: 12 }}>{format(d.b)}</b></span><span className="row faint">Net <b className="num" style={{ marginLeft: "auto", paddingLeft: 12, color: d.a - d.b >= 0 ? "var(--good)" : "var(--bad)" }}>{format(d.a - d.b)}</b></span></div>)} onMouseLeave={tip.hide}>
                <rect x={band * i} y={0} width={band} height={height} fill="transparent" />
                <rect x={cx - bw - 1.5} y={height - pad.b - h(d.a)} width={bw} height={Math.max(d.a > 0 ? 2 : 0, h(d.a))} rx={3} fill={colors[0]} />
                <rect x={cx + 1.5} y={height - pad.b - h(d.b)} width={bw} height={Math.max(d.b > 0 ? 2 : 0, h(d.b))} rx={3} fill={colors[1]} opacity={0.85} />
                <text x={cx} y={height - 6} textAnchor="middle">{d.label}</text>
              </g>
            );
          })}
        </svg>
      )}
      {tip.node}
    </div>
  );
}

export function Donut({ data, size = 170, format = String, center }: { data: { label: string; value: number; color: string }[]; size?: number; format?: (n: number) => string; center?: ReactNode }) {
  const tip = useTip();
  const total = data.reduce((s, d) => s + d.value, 0);
  const r = size / 2 - 10, c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div style={{ width: size, height: size, position: "relative", flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--plate-2)" strokeWidth={13} />
        {total > 0 && data.map((d) => {
          const len = (d.value / total) * c, off = acc;
          acc += len;
          return <circle key={d.label} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={d.color} strokeWidth={13} strokeDasharray={`${Math.max(0, len - 2.5)} ${c}`} strokeDashoffset={-off} style={{ transition: "all var(--slow) var(--ease)" }}
            onMouseMove={(e) => tip.show(e, <span>{d.label} · <b className="num">{format(d.value)}</b> · {Math.round((d.value / total) * 100)}%</span>)} onMouseLeave={tip.hide} />;
        })}
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", textAlign: "center", pointerEvents: "none" }}>{center}</div>
      {tip.node}
    </div>
  );
}

export function Heatmap({ rows, cols, cells, max, color = "var(--hue)", format = String }: { rows: string[]; cols: string[]; cells: number[][]; max: number; color?: string; format?: (n: number) => string }) {
  const tip = useTip();
  return (
    <div style={{ display: "grid", gridTemplateColumns: `minmax(90px, 150px) repeat(${cols.length}, minmax(22px, 1fr))`, gap: 4, alignItems: "center" }}>
      <span />
      {cols.map((c) => <span key={c} className="label" style={{ textAlign: "center", fontSize: 9.5 }}>{c}</span>)}
      {rows.map((r, i) => [
        <span key={r} className="small dim truncate">{r}</span>,
        ...cols.map((c, j) => {
          const v = cells[i][j];
          return <div key={r + c} style={{ height: 24, borderRadius: 6, background: v > 0 ? `color-mix(in srgb, ${color} ${Math.round(12 + 78 * Math.sqrt(v / (max || 1)))}%, transparent)` : "var(--plate)", border: "1px solid var(--line)" }}
            onMouseMove={(e) => tip.show(e, <span>{r} · {c} · <b className="num">{format(v)}</b></span>)} onMouseLeave={tip.hide} />;
        }),
      ])}
      {tip.node}
    </div>
  );
}

export function Spark({ values, color = "var(--hue)", width = 120, height = 34 }: { values: number[]; color?: string; width?: number; height?: number }) {
  if (values.length < 2) return <svg width={width} height={height} />;
  const lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * width},${height - 3 - ((v - lo) / span) * (height - 6)}`);
  return (
    <svg width={width} height={height} style={{ overflow: "visible" }}>
      <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={width} cy={+pts[pts.length - 1].split(",")[1]} r={2.6} fill={color} />
    </svg>
  );
}
