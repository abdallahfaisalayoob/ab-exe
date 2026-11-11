// Home — the command centre. A hero that shows the shape of today, and a set of
// instruments that can be rearranged and saved as named workspaces.
import { ReactNode, useCallback, useMemo, useState } from "react";
import { q, run } from "../lib/backend";
import { capture, openFile } from "../lib/actions";
import { DAYS, MONTHS, ago, daysUntil, dow, fmtDate, hm, relDay, today, ymd } from "../lib/dates";
import { monthlyFlow, monthsBack, netWorth, netWorthSeries, type Account, type Tx } from "../lib/finance";
import { money, plural } from "../lib/format";
import { useCourseFocus, useNow, useQ, useRows, useSetting } from "../lib/hooks";
import { computeInsights } from "../lib/insights";
import { DEFAULT_RULES } from "../lib/workload";
import { ask, useUI, World } from "../lib/store";
import { Icon, KIND_ICON } from "../ui/Icons";
import { Spark } from "../ui/charts";
import { TodayStudy } from "../shell/Study";
import { Check, Empty, Menu, MenuItem, Ring, useDrag } from "../ui/kit";

type WidgetId = "deadlines" | "projects" | "recent" | "finance" | "goals" | "insights" | "capture" | "spaces";
interface Placed { id: WidgetId; span: 1 | 2 }
const ALL: Record<WidgetId, { title: string; world: World }> = {
  deadlines: { title: "Coming up", world: "academy" }, projects: { title: "Active projects", world: "projects" }, recent: { title: "Recent files", world: "knowledge" },
  finance: { title: "Money", world: "finance" }, goals: { title: "Personal goals", world: "home" }, insights: { title: "Worth knowing", world: "home" },
  capture: { title: "Inbox & capture", world: "tools" }, spaces: { title: "Your spaces", world: "knowledge" },
};
const PRESETS: Record<string, Placed[]> = {
  Everyday: [{ id: "deadlines", span: 1 }, { id: "insights", span: 1 }, { id: "projects", span: 1 }, { id: "finance", span: 1 }, { id: "recent", span: 2 }, { id: "goals", span: 1 }, { id: "capture", span: 1 }, { id: "spaces", span: 2 }],
  Study: [{ id: "deadlines", span: 2 }, { id: "projects", span: 1 }, { id: "insights", span: 1 }, { id: "recent", span: 2 }, { id: "spaces", span: 2 }],
  Money: [{ id: "finance", span: 2 }, { id: "goals", span: 1 }, { id: "insights", span: 1 }],
};

export default function Home() {
  const now = useNow();
  const go = useUI((s) => s.go);
  const [layouts, setLayouts] = useSetting<Record<string, Placed[]>>("home.layouts", PRESETS);
  const [active, setActive] = useSetting("home.active", "Everyday");
  const [arrange, setArrange] = useState(false);
  const layout = layouts[active] ?? PRESETS.Everyday;
  const save = (next: Placed[]) => setLayouts({ ...layouts, [active]: next });
  const drag = useDrag<WidgetId>(useCallback((id, _target, index) => {
    const from = layout.findIndex((w) => w.id === id);
    if (from < 0) return;
    const next = [...layout];
    const [moved] = next.splice(from, 1);
    next.splice(index > from ? index - 1 : index, 0, moved);
    save(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, layouts, active]));

  const hour = now.getHours();
  const greeting = hour < 5 ? "Still up." : hour < 12 ? "Good morning." : hour < 17 ? "Good afternoon." : hour < 22 ? "Good evening." : "Winding down.";
  const hidden = (Object.keys(ALL) as WidgetId[]).filter((id) => !layout.some((w) => w.id === id));

  return (
    <div className="world-body" style={{ display: "grid", gridTemplateColumns: "minmax(360px, 5fr) 8fr", gap: 44, paddingTop: 26 }}>
      <section className="col" style={{ position: "sticky", top: 0, alignSelf: "start", gap: 0 }}>
        <span className="label">{DAYS[dow(now)]} · {now.getDate()} {MONTHS[now.getMonth()]} {now.getFullYear()}</span>
        <h1 className="display" style={{ fontSize: "clamp(52px, 5.4vw, 84px)", margin: "10px 0 0" }}>{greeting}</h1>
        <DayArc now={now} />
      </section>

      <section className="col gap4" style={{ minWidth: 0 }}>
        <div className="row between">
          <div className="row gap1 wrap">
            {Object.keys(layouts).map((name) => <button key={name} className={"chip" + (name === active ? " on" : "")} onClick={() => setActive(name)}>{name}</button>)}
            {arrange && <button className="chip" onClick={async () => { const name = (await ask("Name this workspace"))?.trim(); if (name) { setLayouts({ ...layouts, [name]: layout }); setActive(name); } }}><Icon name="plus" size={11} />Save as…</button>}
            {arrange && !(active in PRESETS) && <button className="chip" onClick={() => { const { [active]: _, ...rest } = layouts; setLayouts(rest); setActive("Everyday"); }}><Icon name="trash" size={11} />Remove “{active}”</button>}
            {arrange && active in PRESETS && <button className="chip" onClick={() => save(PRESETS[active])}><Icon name="undo" size={11} />Reset</button>}
          </div>
          <button className={"btn sm " + (arrange ? "primary" : "ghost")} onClick={() => setArrange(!arrange)}><Icon name={arrange ? "check" : "grid"} size={13} />{arrange ? "Done" : "Arrange"}</button>
        </div>

        <div data-drop="home" className="stagger" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          {layout.map((w, i) => (
            <div key={w.id} data-drag-index={i} className={"plate" + (arrange ? "" : " lit")} {...(arrange ? drag.handle(w.id, ALL[w.id].title) : {})}
              style={{ gridColumn: `span ${w.span}`, padding: "16px 18px 14px", minWidth: 0, "--hue": `var(--hue-${ALL[w.id].world})`, opacity: drag.dragging === w.id ? 0.35 : 1, cursor: arrange ? "grab" : undefined, outline: arrange ? "1px dashed var(--line-2)" : undefined, outlineOffset: 3 } as any}>
              <div className="section-head">
                <button className="label row" onClick={() => !arrange && ALL[w.id].world !== "home" && go(ALL[w.id].world)}>{arrange && <Icon name="drag" size={13} />}{ALL[w.id].title}</button>
                {arrange && <div className="row gap1">
                  <button className="btn sm ghost" onClick={() => save(layout.map((x) => (x.id === w.id ? { ...x, span: x.span === 1 ? 2 : 1 } : x)))}>{w.span === 1 ? "Widen" : "Narrow"}</button>
                  <button className="icon-btn sm" aria-label="Hide" onClick={() => save(layout.filter((x) => x.id !== w.id))}><Icon name="x" size={13} /></button>
                </div>}
              </div>
              <div style={{ pointerEvents: arrange ? "none" : undefined }}>{WIDGETS[w.id](w.span)}</div>
            </div>
          ))}
        </div>
        {arrange && hidden.length > 0 && <div className="row wrap"><span className="small faint">Add:</span>{hidden.map((id) => <button key={id} className="chip" onClick={() => save([...layout, { id, span: 1 }])}><Icon name="plus" size={11} />{ALL[id].title}</button>)}</div>}
        {layout.length === 0 && <Empty icon="grid" title="An empty workspace">Choose “Arrange” to add instruments to this view.</Empty>}
      </section>
      {drag.ghost}
    </div>
  );
}

/** Today as an arc from the start to the end of the waking day. */
function DayArc({ now }: { now: Date }) {
  const go = useUI((s) => s.go);
  const [rules] = useSetting("studyRules", DEFAULT_RULES);
  const r = { ...DEFAULT_RULES, ...rules };
  const date = ymd(now);
  const slots = useRows<any>("SELECT s.*, c.name, c.code, c.color FROM class_slots s JOIN courses c ON c.id = s.course_id WHERE s.day = ? AND c.archived = 0 ORDER BY s.start_min", [dow(now)]);
  const due = useRows<any>("SELECT d.*, c.color FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = 0 AND substr(d.due_at, 1, 10) = ? ORDER BY d.due_at", [date]);
  const sessions = useRows<any>("SELECT s.*, c.name, c.color FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.date = ? ORDER BY s.start_min", [date]);
  const hasTimetable = useRows<any>("SELECT COUNT(*) n FROM class_slots")[0]?.n > 0;

  const W = 460, H = 250, cx = W / 2, cy = 232, R = 196;
  const from = Math.min(r.dayStart, ...slots.map((s: any) => s.start_min)), to = Math.max(r.dayEnd, ...slots.map((s: any) => s.end_min));
  const ang = (min: number) => Math.PI * (1 - Math.max(0, Math.min(1, (min - from) / (to - from))));
  const pt = (min: number, rad = R) => [cx + rad * Math.cos(ang(min)), cy - rad * Math.sin(ang(min))];
  const arc = (a: number, b: number, rad = R) => { const [x1, y1] = pt(a, rad), [x2, y2] = pt(b, rad); return `M${x1.toFixed(1)},${y1.toFixed(1)}A${rad},${rad} 0 0 1 ${x2.toFixed(1)},${y2.toFixed(1)}`; };
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const inDay = nowMin >= from && nowMin <= to;
  const [nx, ny] = pt(nowMin);

  const current = slots.find((s: any) => s.start_min <= nowMin && s.end_min > nowMin);
  const next = slots.find((s: any) => s.start_min > nowMin);
  const hoursLeft = slots.filter((s: any) => s.end_min > nowMin).reduce((n: number, s: any) => n + (s.end_min - Math.max(s.start_min, nowMin)), 0);
  let line: ReactNode;
  if (current) line = <>In <b>{current.name}</b> until {hm(current.end_min)}{current.room ? ` · ${current.room}` : ""}</>;
  else if (next) { const m = next.start_min - nowMin; line = <><b>{next.name}</b> {m < 60 ? `in ${m} min` : `at ${hm(next.start_min)}`}{next.room ? ` · ${next.room}` : ""}</>; }
  else if (slots.length) line = <>Classes are done for today.</>;
  else if (hasTimetable) line = <>No classes today.</>;
  else line = null;

  const ticks = [];
  for (let m = Math.ceil(from / 120) * 120; m <= to; m += 120) ticks.push(m);

  return (
    <div className="col" style={{ marginTop: 26, gap: 14 }}>
      <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", maxWidth: 520, overflow: "visible" }} role="img" aria-label="Today's schedule">
        <defs><filter id="glow"><feGaussianBlur stdDeviation="5" /></filter></defs>
        <path d={arc(from, to)} fill="none" stroke="var(--line-2)" strokeWidth={1.2} />
        {inDay && <path d={arc(from, nowMin)} fill="none" stroke="var(--hue)" strokeWidth={1.4} opacity={0.55} />}
        {ticks.map((m) => { const [x1, y1] = pt(m, R - 5), [x2, y2] = pt(m, R + 5), [tx, ty] = pt(m, R + 20); return <g key={m}><line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ink-4)" /><text x={tx} y={ty + 3} textAnchor="middle" fill="var(--ink-3)" style={{ font: "500 9.5px var(--font-mono)" }}>{hm(m)}</text></g>; })}
        {sessions.map((s: any) => <path key={"s" + s.id} d={arc(s.start_min, s.end_min, R - 16)} fill="none" stroke={s.color ?? "var(--hue-academy)"} strokeWidth={3} strokeLinecap="round" strokeDasharray="1 7" />)}
        {slots.map((s: any) => (
          <g key={s.id} style={{ cursor: "pointer" }} onClick={() => go("academy", { tab: "week" })}>
            <path d={arc(s.start_min + 3, s.end_min - 3)} fill="none" stroke={s.color} strokeWidth={9} strokeLinecap="round" opacity={s.end_min < nowMin ? 0.32 : 1} />
            <title>{`${s.name} · ${hm(s.start_min)}–${hm(s.end_min)}${s.room ? " · " + s.room : ""}`}</title>
          </g>
        ))}
        {due.map((d: any) => { const m = Math.max(from, Math.min(to, +d.due_at.slice(11, 13) * 60 + +d.due_at.slice(14, 16))); const [x, y] = pt(m, R - 30); return <g key={"d" + d.id}><path d={`M${x},${y - 5}l5,5l-5,5l-5,-5Z`} fill={d.color ?? "var(--warn)"} /><title>{`${d.title} · due ${d.due_at.slice(11)}`}</title></g>; })}
        {inDay && <><circle cx={nx} cy={ny} r={11} fill="var(--hue)" filter="url(#glow)" opacity={0.8} /><circle cx={nx} cy={ny} r={5} fill="var(--hue)" stroke="var(--bg)" strokeWidth={2} /></>}
        <text x={cx} y={cy - 74} textAnchor="middle" fill="var(--ink)" style={{ font: "400 62px var(--font-display)" }}>{hm(nowMin)}</text>
        <text x={cx} y={cy - 46} textAnchor="middle" fill="var(--ink-3)" style={{ font: "500 10px var(--font-mono)", letterSpacing: ".14em" }}>
          {slots.length ? `${slots.length} ${slots.length === 1 ? "CLASS" : "CLASSES"}${hoursLeft > 0 ? ` · ${(hoursLeft / 60).toFixed(1)}H LEFT` : ""}` : "OPEN DAY"}{due.length ? ` · ${due.length} DUE` : ""}
        </text>
      </svg>
      {line ? <p className="lead dim">{line}</p> : (
        <p className="dim" style={{ maxWidth: 420 }}>This arc is your day. <button className="hue" onClick={() => go("academy", { tab: "week", action: "import" })}>Import your timetable</button> and your classes, study sessions and deadlines will appear along it.</p>
      )}
      {due.length > 0 && <div className="col gap1">{due.map((d: any) => <div key={d.id} className="row small"><span className="dot" style={{ "--c": d.color ?? "var(--warn)" } as any} /><span className="grow truncate">{d.title}</span><span className="faint mono">{d.due_at.slice(11)}</span></div>)}</div>}
      <TodayStudy />
    </div>
  );
}

function Deadlines({ span }: { span: number }) {
  const set = useUI((s) => s.set);
  const [focus] = useCourseFocus();
  const rows = useRows<any>("SELECT d.*, c.name course, c.color FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = 0 AND (? IS NULL OR d.course_id = ?) ORDER BY d.due_at LIMIT ?", [focus?.id ?? null, focus?.id ?? null, span === 2 ? 8 : 5]);
  if (!rows.length) return <Quiet text={focus ? `Nothing due for ${focus.name}.` : "Nothing with a date yet."} action="Add a deadline" onClick={() => set({ quick: { type: "deadline" } })} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: span === 2 ? "1fr 1fr" : "1fr", gap: "0 18px", margin: "0 -8px" }}>
      {rows.map((d) => {
        const n = daysUntil(d.due_at);
        return (
          <div key={d.id} className="list-row" style={{ padding: "7px 8px" }} onClick={() => set({ quick: { type: "deadline", init: { id: d.id } } })}>
            <Check on={false} onChange={() => run("UPDATE deadlines SET done = 1, done_at = ? WHERE id = ?", [Date.now(), d.id])} />
            <div className="col grow" style={{ gap: 0 }}><span className="truncate">{d.title}</span><span className="small faint truncate">{d.kind}{d.course ? ` · ${d.course}` : ""} · {fmtDate(d.due_at)}</span></div>
            <span className={"mono small num " + (n < 0 ? "bad" : n <= 2 ? "warn" : "faint")} style={{ whiteSpace: "nowrap" }}>{n < 0 ? `${-n}d late` : n === 0 ? "today" : `${n}d`}</span>
          </div>
        );
      })}
    </div>
  );
}

function ProjectsW() {
  const { go, set } = useUI();
  const rows = useRows<any>("SELECT p.*, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) total, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') done, (SELECT MIN(date) FROM milestones m WHERE m.project_id = p.id AND m.done = 0) next_ms FROM projects p WHERE p.status = 'active' ORDER BY p.priority DESC, p.due_date IS NULL, p.due_date LIMIT 4");
  if (!rows.length) return <Quiet text="No active projects." action="Start one" onClick={() => set({ quick: { type: "project" } })} />;
  return <div className="col" style={{ gap: 2, margin: "0 -8px" }}>{rows.map((p) => (
    <button key={p.id} className="list-row" style={{ textAlign: "left", padding: "7px 8px" }} onClick={() => go("projects", { id: p.id })}>
      <Ring value={p.total ? p.done / p.total : 0} size={34} stroke={3} color={p.color} />
      <div className="col grow" style={{ gap: 0 }}><span className="truncate">{p.name}</span><span className="small faint truncate">{p.total ? `${p.done}/${p.total} tasks` : "No tasks yet"}{p.next_ms ? ` · milestone ${relDay(p.next_ms)}` : p.due_date ? ` · due ${relDay(p.due_date)}` : ""}</span></div>
    </button>
  ))}</div>;
}

function Recent({ span }: { span: number }) {
  const go = useUI((s) => s.go);
  const [focus] = useCourseFocus();
  const rows = useRows<any>("SELECT id, name, path, kind, MAX(COALESCE(opened_at, 0), imported_at) t, opened_at FROM files WHERE missing = 0 AND (? IS NULL OR id IN (SELECT a_id FROM links WHERE a_type = 'file' AND b_type = 'course' AND b_id = ?)) ORDER BY t DESC LIMIT ?", [focus?.id ?? null, focus?.id ?? null, span === 2 ? 8 : 4]);
  if (!rows.length && focus) return <p className="small faint">No files are linked to {focus.name} yet. Link them from the course workspace or the file inspector.</p>;
  if (!rows.length) return <Quiet text="Drop a folder anywhere in this window to begin your library." action="Import a folder" onClick={() => go("knowledge", { action: "import" })} />;
  return <div style={{ display: "grid", gridTemplateColumns: span === 2 ? "repeat(4, 1fr)" : "1fr 1fr", gap: 8 }}>{rows.map((f) => (
    <button key={f.id} className={"plate hover kind-" + f.kind} style={{ padding: 11, textAlign: "left", borderRadius: 12 }} onClick={() => go("knowledge", { action: "select", id: f.id })} onDoubleClick={() => openFile(f)} title={f.path}>
      <Icon name={KIND_ICON[f.kind]} size={17} style={{ color: "var(--c)" }} />
      <div className="small clamp2" style={{ marginTop: 8, minHeight: 34, wordBreak: "break-word" }}>{f.name}</div>
      <div className="faint" style={{ fontSize: 10.5, marginTop: 4 }}>{f.opened_at ? "opened " : "added "}{ago(f.t)}</div>
    </button>
  ))}</div>;
}

function FinanceW({ span }: { span: number }) {
  const go = useUI((s) => s.go);
  const [base] = useSetting("currency", "PKR");
  const [rate] = useSetting("usdRate", 0);
  const data = useQ(async () => ({ accounts: await q<Account>("SELECT * FROM accounts"), txs: await q<Tx>("SELECT * FROM transactions") }), []).data;
  if (!data) return null;
  if (!data.accounts.length) return <Quiet text="Add an account to see your net worth and monthly flow here." action="Set up Finance" onClick={() => go("finance", { tab: "accounts", action: "new" })} />;
  const months = monthsBack(6);
  const nw = netWorth(data.accounts, data.txs, base, rate);
  const flow = monthlyFlow(data.accounts, data.txs, base, rate, months).at(-1)!;
  const series = netWorthSeries(data.accounts, data.txs, base, rate, months).map((p) => p.value);
  return (
    <div className="row between gap4" style={{ alignItems: "flex-end" }}>
      <div className="col gap1"><span className="display num" style={{ fontSize: 34 }}>{money(nw.net, base, { compact: true })}</span><span className="small faint">net worth</span></div>
      {span === 2 && <Spark values={series} width={200} height={44} />}
      <div className="col gap1 small" style={{ textAlign: "right" }}>
        <span className="num"><span className="faint">in </span><span className="good">{money(flow.income, base, { compact: true })}</span></span>
        <span className="num"><span className="faint">out </span>{money(flow.expense, base, { compact: true })}</span>
        <span className="faint">{MONTHS[new Date().getMonth()]}</span>
      </div>
    </div>
  );
}

function Goals() {
  const rows = useRows<any>("SELECT * FROM goals WHERE done = 0 OR done_at > ? ORDER BY done, kind DESC, due_date IS NULL, due_date LIMIT 6", [Date.now() - 3 * 86400000]);
  const [text, setText] = useState("");
  const add = async () => { if (text.trim()) { await run("INSERT INTO goals(title, created_at) VALUES(?, ?)", [text.trim(), Date.now()]); setText(""); } };
  return (
    <div className="col" style={{ gap: 2 }}>
      {rows.map((g) => (
        <div key={g.id} className="row" style={{ padding: "5px 0" }}>
          <Check on={!!g.done} onChange={(v) => run("UPDATE goals SET done = ?, done_at = ? WHERE id = ?", [v ? 1 : 0, v ? Date.now() : null, g.id])} />
          <span className={"grow truncate" + (g.done ? " faint" : "")} style={{ textDecoration: g.done ? "line-through" : undefined }}>{g.title}</span>
          {g.kind === "savings" && g.target_amount ? <span className="small faint num">{Math.round((g.saved_amount / g.target_amount) * 100)}%</span> : g.due_date ? <span className="small faint">{relDay(g.due_date)}</span> : null}
        </div>
      ))}
      <input className="input bare small" style={{ padding: "6px 0" }} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && add()} placeholder={rows.length ? "Add another goal…" : "What are you working towards? Type and press Enter"} />
    </div>
  );
}

function Insights() {
  const go = useUI((s) => s.go);
  const list = useQ(() => computeInsights(), []).data;
  if (!list) return null;
  if (!list.length) return <p className="small faint">Nothing needs your attention. Insights are rule-based readings of your own data — they appear when a week looks crowded, a file goes missing or a month looks unusual.</p>;
  return <div className="col" style={{ gap: 2, margin: "0 -8px" }}>{list.slice(0, 3).map((i) => (
    <button key={i.id} className="list-row" style={{ textAlign: "left", alignItems: "flex-start", padding: "7px 8px" }} onClick={() => go(i.world, { tab: i.tab })} title={i.why}>
      <span className="dot" style={{ marginTop: 7, "--c": i.tone === "warn" ? "var(--warn)" : `var(--hue-${i.world})` } as any} />
      <div className="col grow" style={{ gap: 0 }}><span className="clamp2">{i.title}</span><span className="small faint clamp2">{i.why}</span></div>
    </button>
  ))}{list.length > 3 && <button className="small faint" style={{ textAlign: "left", padding: "4px 8px" }} onClick={() => useUI.getState().set({ activity: true })}>+ {list.length - 3} more in Signals</button>}</div>;
}

function CaptureW() {
  const go = useUI((s) => s.go);
  const counts = useRows<any>("SELECT (SELECT COUNT(*) FROM files WHERE inbox_state = 'new') files, (SELECT COUNT(*) FROM notes WHERE owner_type = 'capture' AND state = 'open') notes")[0];
  const [text, setText] = useState("");
  return (
    <div className="col gap3">
      <input className="input" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && text.trim()) { void capture(text); setText(""); } }} placeholder="Capture a thought and press Enter…" />
      <div className="row gap1 wrap">
        <button className="chip" onClick={() => go("knowledge", { tab: "inbox" })}><Icon name="inbox" size={12} />{plural(counts?.files ?? 0, "file")} to review</button>
        <button className="chip" onClick={() => go("tools", { tab: "capture" })}><Icon name="note" size={12} />{plural(counts?.notes ?? 0, "note")}</button>
      </div>
    </div>
  );
}

function Spaces() {
  const go = useUI((s) => s.go);
  const collections = useRows<any>("SELECT c.id, c.name, c.pinned, (SELECT COUNT(*) FROM files f WHERE f.collection_id = c.id) n FROM collections c WHERE c.kind = 'folder' ORDER BY c.pinned DESC, c.last_scan_at DESC LIMIT 6");
  const courses = useRows<any>("SELECT id, name, code, color FROM courses WHERE archived = 0 ORDER BY name LIMIT 8");
  if (!collections.length && !courses.length) return <p className="small faint">Collections and courses you create will be one click away here.</p>;
  return (
    <div className="row wrap gap1">
      {collections.map((c) => <button key={"c" + c.id} className="chip tint" style={{ "--c": "var(--hue-knowledge)", height: 28 } as any} onClick={() => go("knowledge", { id: c.id })}><Icon name={c.pinned ? "star" : "folder"} size={12} />{c.name}<span className="faint num">{c.n}</span></button>)}
      {courses.map((c) => <button key={"k" + c.id} className="chip tint" style={{ "--c": c.color, height: 28 } as any} onClick={() => go("academy", { tab: "courses", id: c.id })}><Icon name="academy" size={12} />{c.code || c.name}</button>)}
    </div>
  );
}

function Quiet({ text, action, onClick }: { text: string; action: string; onClick: () => void }) {
  return <div className="col gap3" style={{ alignItems: "flex-start", padding: "4px 0 6px" }}><p className="small faint">{text}</p><button className="btn sm" onClick={onClick}><Icon name="plus" size={12} />{action}</button></div>;
}

const WIDGETS: Record<WidgetId, (span: number) => ReactNode> = {
  deadlines: (s) => <Deadlines span={s} />, projects: () => <ProjectsW />, recent: (s) => <Recent span={s} />, finance: (s) => <FinanceW span={s} />,
  goals: () => <Goals />, insights: () => <Insights />, capture: () => <CaptureW />, spaces: () => <Spaces />,
};
