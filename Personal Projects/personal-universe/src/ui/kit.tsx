import { ReactNode, useEffect, useRef, useState } from "react";
import { Icon } from "./Icons";

export function Modal({ title, sub, onClose, children, foot, wide }: { title: string; sub?: ReactNode; onClose: () => void; children: ReactNode; foot?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={"modal" + (wide ? " wide" : "")} role="dialog" aria-label={title}>
        <div className="modal-head">
          <div className="col gap1"><h2 className="display" style={{ fontSize: 28 }}>{title}</h2>{sub && <div className="faint small">{sub}</div>}</div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" size={16} /></button>
        </div>
        <div className="modal-body">{children}</div>
        {foot && <div className="modal-foot">{foot}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return <label className="field"><span>{label}</span>{children}{hint && <span className="faint">{hint}</span>}</label>;
}

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; icon?: string }[] }) {
  return (
    <div className="seg" role="tablist">
      {options.map((o) => (
        <button key={o.value} className={value === o.value ? "on" : ""} onClick={() => onChange(o.value)} role="tab" aria-selected={value === o.value}>
          {o.icon && <Icon name={o.icon} size={14} />}{o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, tabs, right }: { value: T; onChange: (v: T) => void; tabs: { id: T; label: string; count?: number }[]; right?: ReactNode }) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button key={t.id} className={"tab" + (value === t.id ? " on" : "")} onClick={() => onChange(t.id)}>
          {t.label}{t.count ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
      {right && <div className="row grow" style={{ justifyContent: "flex-end", paddingBottom: 6 }}>{right}</div>}
    </div>
  );
}

export function Empty({ icon, title, children, action }: { icon: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="glyph"><Icon name={icon} size={26} stroke={1.2} /></div>
      <h3>{title}</h3>
      {children && <p className="small">{children}</p>}
      {action && <div className="row" style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}

export function Check({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label?: string }) {
  return <button className={"check" + (on ? " on" : "")} onClick={(e) => { e.stopPropagation(); onChange(!on); }} role="checkbox" aria-checked={on} aria-label={label ?? "Done"}><Icon name="check" size={12} stroke={2.4} /></button>;
}
export function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button className={"toggle" + (on ? " on" : "")} onClick={() => onChange(!on)} role="switch" aria-checked={on} aria-label={label} />;
}

/** Destructive actions ask once, inline, without a blocking dialog. */
export function Confirm({ label = "Delete", onConfirm, icon = "trash", className = "icon-btn sm" }: { label?: string; onConfirm: () => void; icon?: string; className?: string }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => { if (armed) { const t = setTimeout(() => setArmed(false), 3200); return () => clearTimeout(t); } }, [armed]);
  if (armed) return <button className="btn sm danger" onClick={(e) => { e.stopPropagation(); onConfirm(); setArmed(false); }}>Confirm {label.toLowerCase()}</button>;
  return <button className={className} title={label} aria-label={label} onClick={(e) => { e.stopPropagation(); setArmed(true); }}><Icon name={icon} size={15} />{className.includes("btn ") || className === "btn" ? label : null}</button>;
}

export function Menu({ button, children, align = "right" }: { button: ReactNode; children: (close: () => void) => ReactNode; align?: "left" | "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener("mousedown", off);
    return () => window.removeEventListener("mousedown", off);
  }, [open]);
  return (
    <div ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <span onClick={() => setOpen(!open)} style={{ display: "inline-flex" }}>{button}</span>
      {open && <div className="plate glass" style={{ position: "absolute", top: "calc(100% + 6px)", [align]: 0, zIndex: 50, padding: 6, minWidth: 200, borderRadius: 14, boxShadow: "var(--shadow)", animation: "rise var(--fast) var(--ease) both" }}>{children(() => setOpen(false))}</div>}
    </div>
  );
}
export function MenuItem({ icon, children, onClick, danger }: { icon?: string; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button className={"list-row small" + (danger ? " bad" : "")} style={{ width: "100%", padding: "7px 9px", gap: 9 }} onClick={onClick}>{icon && <Icon name={icon} size={15} />}<span className="truncate">{children}</span></button>;
}

export function Ring({ value, size = 44, stroke = 3.5, color = "var(--hue)", children }: { value: number; size?: number; stroke?: number; color?: string; children?: ReactNode }) {
  const r = (size - stroke) / 2, c = 2 * Math.PI * r, v = Math.max(0, Math.min(1, value || 0));
  return (
    <div style={{ width: size, height: size, position: "relative", flex: "none" }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--plate-3)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v)} style={{ transition: "stroke-dashoffset var(--slow) var(--ease)" }} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", fontSize: size < 40 ? 9.5 : 11 }} className="mono num">{children ?? Math.round(v * 100)}</div>
    </div>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: string }) {
  return (
    <div className="col gap1" style={{ minWidth: 0 }}>
      <span className="label">{label}</span>
      <span className={"display num " + (tone ?? "")} style={{ fontSize: 30 }}>{value}</span>
      {sub && <span className="small faint">{sub}</span>}
    </div>
  );
}

export function SectionHead({ label, children }: { label: string; children?: ReactNode }) {
  return <div className="section-head"><span className="label">{label}</span><div className="row">{children}</div></div>;
}

/**
 * Pointer-based drag. HTML5 drag-and-drop is unavailable inside the desktop webview while
 * native file drops are enabled, so reordering and boards use this instead.
 */
export function useDrag<T>(onDrop: (item: T, target: string, index: number) => void) {
  const [drag, setDrag] = useState<{ item: T; x: number; y: number; label: string; over: string | null } | null>(null);
  const state = useRef<{ item: T; label: string; sx: number; sy: number; active: boolean } | null>(null);
  useEffect(() => {
    const find = (x: number, y: number) => {
      const el = (document.elementFromPoint(x, y) as HTMLElement | null)?.closest("[data-drop]") as HTMLElement | null;
      if (!el) return null;
      const kids = [...el.querySelectorAll(":scope [data-drag-index]")] as HTMLElement[];
      let index = kids.length;
      for (const k of kids) { const r = k.getBoundingClientRect(); if (y < r.top + r.height / 2 && x < r.right) { index = +k.dataset.dragIndex!; break; } }
      return { id: el.dataset.drop!, index };
    };
    const move = (e: PointerEvent) => {
      const s = state.current;
      if (!s) return;
      if (!s.active && Math.hypot(e.clientX - s.sx, e.clientY - s.sy) < 6) return;
      s.active = true;
      setDrag({ item: s.item, x: e.clientX, y: e.clientY, label: s.label, over: find(e.clientX, e.clientY)?.id ?? null });
    };
    const up = (e: PointerEvent) => {
      const s = state.current;
      state.current = null;
      if (s?.active) { const t = find(e.clientX, e.clientY); if (t) onDrop(s.item, t.id, t.index); }
      setDrag(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
  }, [onDrop]);
  const handle = (item: T, label: string) => ({
    onPointerDown: (e: React.PointerEvent) => { if (e.button === 0 && !(e.target as HTMLElement).closest("button, input, a, textarea, select")) state.current = { item, label, sx: e.clientX, sy: e.clientY, active: false }; },
    style: { touchAction: "none" as const },
  });
  const ghost = drag && (
    <div style={{ position: "fixed", left: drag.x + 12, top: drag.y + 10, zIndex: 500, pointerEvents: "none", padding: "7px 12px", borderRadius: 10, background: "var(--glass)", border: "1px solid var(--hue)", boxShadow: "var(--shadow)", fontSize: 12, maxWidth: 260 }} className="truncate">{drag.label}</div>
  );
  return { handle, ghost, dragging: drag?.item ?? null, over: drag?.over ?? null };
}
