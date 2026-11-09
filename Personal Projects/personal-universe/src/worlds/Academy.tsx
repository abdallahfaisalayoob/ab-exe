// Academy — the semester, understood. Timetable, calendar, deadlines, courses and the
// prompt library live here; the workload planner is in AcademyPlanner.tsx.
import { useEffect, useMemo, useState } from "react";
import { batch, call, log, native, q, run } from "../lib/backend";
import { DAYS, MONTHS, addDays, daysUntil, dow, fmtDate, hm, parseHm, relDay, today, weekStart, ymd } from "../lib/dates";
import { PALETTE, plural } from "../lib/format";
import { useIntent, useNow, useRows } from "../lib/hooks";
import { SUBJECTS } from "../lib/prompts";
import { attempt, toast, useUI } from "../lib/store";
import { findConflicts, parseTimetable, ParseResult } from "../lib/timetable";
import { Icon } from "../ui/Icons";
import { Check, Confirm, Empty, Field, Modal, Seg, Tabs } from "../ui/kit";
import { LinkedFiles } from "../shell/Files";
import { Planner } from "./AcademyPlanner";

type Tab = "week" | "month" | "planner" | "deadlines" | "courses" | "prompts";
const KIND_TONE: Record<string, string> = { exam: "var(--bad)", quiz: "var(--warn)", assignment: "var(--hue-academy)", lab: "var(--hue-knowledge)", presentation: "var(--hue-projects)", milestone: "var(--hue-projects)", reminder: "var(--ink-3)", event: "var(--ink-3)" };

export default function Academy() {
  const set = useUI((s) => s.set);
  const [tab, setTab] = useState<Tab>("week");
  const [courseId, setCourseId] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [filter, setFilter] = useState<{ range?: string; kind?: string }>({});
  useIntent("academy", (i) => {
    if (i.tab) setTab(i.tab as Tab);
    if (i.id) { setTab("courses"); setCourseId(i.id); }
    if (i.action === "import") setImporting(true);
    if (i.payload) setFilter(i.payload);
  });
  const open = useRows<any>("SELECT COUNT(*) n FROM deadlines WHERE done = 0")[0]?.n;
  return (
    <>
      <div className="world-head">
        <div><h1 className="display">Academy</h1><p className="sub">Your timetable, deadlines and courses in one place — with a planner that shows where the semester gets heavy.</p></div>
        <div className="row">
          <button className="btn" onClick={() => setImporting(true)}><Icon name="upload" size={14} />Import timetable</button>
          <button className="btn" onClick={() => set({ quick: { type: "course" } })}><Icon name="plus" size={14} />Course</button>
          <button className="btn primary" onClick={() => set({ quick: { type: "deadline" } })}><Icon name="flag" size={14} />Deadline</button>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "week", label: "Timetable" }, { id: "month", label: "Calendar" }, { id: "planner", label: "Workload planner" }, { id: "deadlines", label: "Deadlines", count: open }, { id: "courses", label: "Courses" }, { id: "prompts", label: "Prompt library" }]} />
      <div className="world-body">
        {tab === "week" && <Week onImport={() => setImporting(true)} />}
        {tab === "month" && <Month />}
        {tab === "planner" && <Planner />}
        {tab === "deadlines" && <Deadlines filter={filter} clear={() => setFilter({})} />}
        {tab === "courses" && <Courses selected={courseId} select={setCourseId} />}
        {tab === "prompts" && <Prompts />}
      </div>
      {importing && <TimetableImport onClose={() => setImporting(false)} onDone={() => { setImporting(false); setTab("week"); }} />}
    </>
  );
}

// ── Timetable ────────────────────────────────────────────────────────────────
function Week({ onImport }: { onImport: () => void }) {
  const now = useNow();
  const [mode, setMode] = useState<"week" | "day">("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [only, setOnly] = useState<number | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const slots = useRows<any>("SELECT s.*, c.name, c.code, c.color FROM class_slots s JOIN courses c ON c.id = s.course_id WHERE c.archived = 0 ORDER BY s.day, s.start_min");
  const courses = useRows<any>("SELECT * FROM courses WHERE archived = 0 ORDER BY name");
  const start = weekStart(anchor);
  const sessions = useRows<any>("SELECT s.*, c.color, c.name FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.date BETWEEN ? AND ?", [ymd(start), ymd(addDays(start, 6))]);
  const due = useRows<any>("SELECT d.*, c.color FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = 0 AND substr(d.due_at, 1, 10) BETWEEN ? AND ? ORDER BY d.due_at", [ymd(start), ymd(addDays(start, 6))]);
  const conflicts = useMemo(() => findConflicts(slots), [slots]);
  const clash = new Set(conflicts.flatMap((c) => [c.a.id, c.b.id]));

  if (!slots.length && !courses.length) return <Empty icon="calendar" title="No timetable yet" action={<><button className="btn primary" onClick={onImport}><Icon name="upload" size={14} />Import an Excel timetable</button><button className="btn" onClick={() => useUI.getState().set({ quick: { type: "course" } })}>Add a course by hand</button></>}>Upload the spreadsheet your university gave you. It is read on this computer, you choose which courses are yours, and you can correct anything before it is saved.</Empty>;

  const shown = slots.filter((s) => only == null || s.course_id === only);
  const days = mode === "day" ? [dow(anchor)] : slots.some((s) => s.day === 6) ? [0, 1, 2, 3, 4, 5, 6] : slots.some((s) => s.day === 5) ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4];
  const lo = Math.floor(Math.min(8 * 60, ...slots.map((s) => s.start_min)) / 60) * 60, hi = Math.ceil(Math.max(17 * 60, ...slots.map((s) => s.end_min), ...sessions.map((s: any) => s.end_min)) / 60) * 60;
  const PX = 0.95, H = (hi - lo) * PX;
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const isThisWeek = ymd(weekStart(now)) === ymd(start);
  return (
    <div className="col gap4">
      <div className="row between wrap gap3">
        <div className="row">
          <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, mode === "day" ? -1 : -7))} aria-label="Previous"><Icon name="chevL" size={16} /></button>
          <button className="btn sm" onClick={() => setAnchor(new Date())}>Today</button>
          <button className="icon-btn" onClick={() => setAnchor(addDays(anchor, mode === "day" ? 1 : 7))} aria-label="Next"><Icon name="chevR" size={16} /></button>
          <span className="title" style={{ marginLeft: 8 }}>{mode === "day" ? fmtDate(anchor, "long") : `${fmtDate(start)} – ${fmtDate(addDays(start, 6))}`}</span>
        </div>
        <div className="row"><Seg value={mode} onChange={setMode} options={[{ value: "week", label: "Week" }, { value: "day", label: "Day" }]} /><button className="btn sm" onClick={() => setEdit({ day: dow(anchor), start_min: 540, end_min: 620, course_id: courses[0]?.id, room: "", kind: "Lecture" })} disabled={!courses.length}><Icon name="plus" size={13} />Class</button></div>
      </div>
      <div className="row wrap gap1">
        <button className={"chip" + (only == null ? " on" : "")} onClick={() => setOnly(null)}>All courses</button>
        {courses.map((c) => <button key={c.id} className={"chip tint" + (only === c.id ? " on" : "")} style={{ "--c": c.color } as any} onClick={() => setOnly(only === c.id ? null : c.id)}><i className="dot" />{c.code || c.name}</button>)}
      </div>
      {conflicts.length > 0 && <div className="plate" style={{ padding: "10px 14px", borderColor: "color-mix(in srgb, var(--bad) 45%, transparent)" }}>
        <div className="row small"><Icon name="warn" size={15} style={{ color: "var(--bad)" }} /><b>{plural(conflicts.length, "timetable conflict")}</b></div>
        {conflicts.map((c, i) => <div key={i} className="small dim" style={{ marginTop: 4 }}>{DAYS[c.day]} {hm(c.start)}–{hm(c.end)}: <b>{c.a.name}</b> overlaps <b>{c.b.name}</b></div>)}
      </div>}
      <div className="plate" style={{ display: "grid", gridTemplateColumns: `52px repeat(${days.length}, 1fr)`, padding: "0 10px 12px 0", overflow: "hidden" }}>
        <span />
        {days.map((d) => { const date = addDays(start, d); const isToday = ymd(date) === ymd(now); return (
          <div key={d} style={{ padding: "12px 8px 10px", borderLeft: "1px solid var(--line)" }}>
            <div className="row between"><span className={isToday ? "hue" : "dim"} style={{ fontWeight: 500 }}>{DAYS[d].slice(0, 3)} <span className="faint num">{date.getDate()}</span></span></div>
            <div className="col" style={{ gap: 3, marginTop: 5, minHeight: 4 }}>{due.filter((x) => x.due_at.slice(0, 10) === ymd(date)).map((x) => <button key={x.id} className="chip tint truncate" style={{ "--c": KIND_TONE[x.kind], height: 19, fontSize: 10, maxWidth: "100%", justifyContent: "flex-start" } as any} onClick={() => useUI.getState().set({ quick: { type: "deadline", init: { id: x.id } } })} title={x.title}><Icon name="flag" size={9} /><span className="truncate">{x.title}</span></button>)}</div>
          </div>); })}
        <div style={{ position: "relative", height: H }}>{Array.from({ length: (hi - lo) / 60 + 1 }, (_, i) => <span key={i} className="mono faint" style={{ position: "absolute", top: i * 60 * PX - 6, right: 8, fontSize: 9.5 }}>{hm(lo + i * 60)}</span>)}</div>
        {days.map((d) => { const date = ymd(addDays(start, d)); return (
          <div key={d} style={{ position: "relative", height: H, borderLeft: "1px solid var(--line)", backgroundImage: `repeating-linear-gradient(var(--line) 0 1px, transparent 1px ${60 * PX}px)` }}>
            {isThisWeek && d === dow(now) && nowMin > lo && nowMin < hi && <div style={{ position: "absolute", left: 0, right: 0, top: (nowMin - lo) * PX, height: 1.5, background: "var(--hue)", boxShadow: "0 0 10px var(--hue)", zIndex: 3 }} />}
            {sessions.filter((s: any) => s.date === date).map((s: any) => <div key={"s" + s.id} title={`Study: ${s.name ?? s.note ?? "session"}`} style={{ position: "absolute", left: 5, right: 5, top: (s.start_min - lo) * PX, height: (s.end_min - s.start_min) * PX - 2, borderRadius: 8, border: `1px dashed ${s.color ?? "var(--hue)"}`, padding: "4px 7px", fontSize: 10.5, color: "var(--ink-2)", overflow: "hidden" }}>Study{s.name ? ` · ${s.name}` : ""}</div>)}
            {shown.filter((s) => s.day === d).map((s) => { const peers = shown.filter((o) => o.day === d && o.start_min < s.end_min && o.end_min > s.start_min); const idx = peers.indexOf(s); return (
              <button key={s.id} onClick={() => setEdit(s)} style={{ position: "absolute", left: `calc(${(idx / peers.length) * 100}% + 4px)`, width: `calc(${100 / peers.length}% - 8px)`, top: (s.start_min - lo) * PX + 1, height: (s.end_min - s.start_min) * PX - 3, borderRadius: 9, background: `color-mix(in srgb, ${s.color} 20%, var(--bg-2))`, borderLeft: `3px solid ${s.color}`, outline: clash.has(s.id) ? "1.5px solid var(--bad)" : "none", padding: "5px 8px", textAlign: "left", overflow: "hidden", zIndex: 2 }}>
                <div className="small truncate" style={{ fontWeight: 500 }}>{s.name}</div>
                <div className="faint truncate" style={{ fontSize: 10.5 }}>{hm(s.start_min)}–{hm(s.end_min)}{s.room ? ` · ${s.room}` : ""}{s.kind !== "Lecture" ? ` · ${s.kind}` : ""}</div>
              </button>); })}
          </div>); })}
      </div>
      {edit && <SlotForm slot={edit} courses={courses} onClose={() => setEdit(null)} />}
    </div>
  );
}

function SlotForm({ slot, courses, onClose }: { slot: any; courses: any[]; onClose: () => void }) {
  const [f, setF] = useState({ ...slot, start: hm(slot.start_min), end: hm(slot.end_min) });
  const set = (p: any) => setF({ ...f, ...p });
  const save = () => attempt(async () => {
    const s = parseHm(f.start), e = parseHm(f.end);
    if (e <= s) throw new Error("The end time must be after the start time.");
    const p = [+f.course_id, +f.day, s, e, f.room ?? "", f.kind ?? "Lecture"];
    if (f.id) await run("UPDATE class_slots SET course_id=?, day=?, start_min=?, end_min=?, room=?, kind=? WHERE id=?", [...p, f.id]);
    else await run("INSERT INTO class_slots(course_id, day, start_min, end_min, room, kind) VALUES(?,?,?,?,?,?)", p);
    onClose();
  });
  return (
    <Modal title={f.id ? "Edit class" : "Add class"} onClose={onClose} foot={<>{f.id && <button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={() => attempt(async () => { await run("DELETE FROM class_slots WHERE id = ?", [f.id]); onClose(); })}>Delete</button>}<button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <Field label="Course"><select className="select" value={f.course_id} onChange={(e) => set({ course_id: e.target.value })}>{courses.map((c) => <option key={c.id} value={c.id}>{c.code ? c.code + " · " : ""}{c.name}</option>)}</select></Field>
      <div className="grid3">
        <Field label="Day"><select className="select" value={f.day} onChange={(e) => set({ day: e.target.value })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></Field>
        <Field label="Starts"><input className="input" type="time" value={f.start} onChange={(e) => set({ start: e.target.value })} /></Field>
        <Field label="Ends"><input className="input" type="time" value={f.end} onChange={(e) => set({ end: e.target.value })} /></Field>
      </div>
      <div className="grid2">
        <Field label="Room"><input className="input" value={f.room ?? ""} onChange={(e) => set({ room: e.target.value })} /></Field>
        <Field label="Type"><select className="select" value={f.kind ?? "Lecture"} onChange={(e) => set({ kind: e.target.value })}>{["Lecture", "Lab", "Tutorial", "Seminar"].map((k) => <option key={k}>{k}</option>)}</select></Field>
      </div>
    </Modal>
  );
}

function TimetableImport({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [res, setRes] = useState<(ParseResult & { file: string }) | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [names, setNames] = useState<Record<string, string>>({});
  const [text, setText] = useState("");
  const [replace, setReplace] = useState(false);
  const existing = useRows<any>("SELECT id, name, code FROM courses");
  const choose = () => attempt(async () => {
    const [path] = await native.pick("sheet");
    if (!path) return;
    const sheets = await call<any[]>("grid.read", { path });
    const r = parseTimetable(sheets);
    setRes({ ...r, file: path.split(/[\\/]/).pop()! });
    // A personal timetable has no overlapping classes — select everything. If classes overlap, this is
    // probably a department-wide sheet with several sections, so the user picks their own.
    setPicked(new Set(r.courses.length <= 14 && findConflicts(r.slots).length === 0 ? r.courses.map((c) => c.key) : []));
  });
  const chosen = res?.courses.filter((c) => picked.has(c.key)) ?? [];
  const clashes = useMemo(() => findConflicts(chosen.flatMap((c) => c.slots.map((s) => ({ ...s, name: names[c.key] ?? c.name })))), [chosen, names]);
  const save = () => attempt(async () => {
    if (!chosen.length) throw new Error("Tick the courses that are yours.");
    if (replace) await batch([{ sql: "DELETE FROM class_slots" }]);
    let ci = existing.length;
    for (const c of chosen) {
      const name = (names[c.key] ?? c.name).trim();
      const match = existing.find((e) => (c.code && e.code.replace(/\W/g, "").toLowerCase() === c.code.replace(/\W/g, "").toLowerCase()) || e.name.toLowerCase() === name.toLowerCase());
      const id = match?.id ?? (await run("INSERT INTO courses(name, code, instructor, color, created_at) VALUES(?,?,?,?,?)", [name, c.code, c.instructor, PALETTE[ci++ % PALETTE.length], Date.now()])).lastId;
      await batch(c.slots.map((s) => ({ sql: "INSERT INTO class_slots(course_id, day, start_min, end_min, room, kind, instructor) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM class_slots WHERE course_id = ? AND day = ? AND start_min = ?)", params: [id, s.day, s.start, s.end, s.room, s.kind, s.instructor, id, s.day, s.start] })));
    }
    void log("academy", "timetable", `Imported timetable from ${res!.file}`, undefined, `${chosen.length} courses · ${chosen.reduce((n, c) => n + c.slots.length, 0)} weekly classes`);
    toast(`Imported ${plural(chosen.length, "course")}.`, "good");
    onDone();
  });
  const list = res?.courses.filter((c) => !text || (c.name + c.code + c.section + c.instructor).toLowerCase().includes(text.toLowerCase())) ?? [];
  return (
    <Modal title="Import a timetable" sub="Read locally from your spreadsheet. Nothing is saved until you confirm." onClose={onClose} wide
      foot={res ? <><label className="row small dim" style={{ marginRight: "auto" }}><Check on={replace} onChange={setReplace} label="Replace" />Replace my current class times</label><button className="btn ghost" onClick={choose}>Choose another file</button><button className="btn primary" onClick={save} disabled={!chosen.length}>Import {chosen.length || ""} {chosen.length === 1 ? "course" : "courses"}</button></> : undefined}>
      {!res ? (
        <Empty icon="upload" title="Choose your timetable spreadsheet" action={<button className="btn primary" onClick={choose}>Choose .xlsx / .xls / .csv</button>}>Understands list layouts (one class per row), day × time grids, and university-wide room grids with one sheet per day. You pick your own courses afterwards.</Empty>
      ) : (
        <>
          <div className="row between wrap gap3"><span className="small dim"><b>{res.file}</b> · {res.format === "none" ? "layout not recognised" : `${res.format} layout`} · {plural(res.courses.length, "course")} · {plural(res.slots.length, "class")} found</span>
            {res.courses.length > 6 && <input className="input" style={{ width: 240, height: 30 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Find your courses or section…" />}</div>
          {picked.size === 0 && res.courses.length > 0 && <div className="small dim row"><Icon name="info" size={13} />This sheet holds more than one person's classes. Tick the courses (and section) that are yours.</div>}
          {res.warnings.map((w) => <div key={w} className="small warn row"><Icon name="warn" size={13} />{w}</div>)}
          {clashes.length > 0 && <div className="small bad row"><Icon name="warn" size={13} />{plural(clashes.length, "clash")} among the selected courses — e.g. {(clashes[0].a as any).name} and {(clashes[0].b as any).name} on {DAYS[clashes[0].day]} at {hm(clashes[0].start)}.</div>}
          <div className="scroll" style={{ maxHeight: 400, margin: "0 -8px" }}>
            {list.map((c) => (
              <div key={c.key} className={"list-row" + (picked.has(c.key) ? " on" : "")} style={{ alignItems: "flex-start" }}>
                <Check on={picked.has(c.key)} onChange={(v) => { const n = new Set(picked); v ? n.add(c.key) : n.delete(c.key); setPicked(n); }} label={c.name} />
                <div className="col grow" style={{ gap: 3 }}>
                  <div className="row"><input className="input bare" style={{ fontWeight: 500 }} value={names[c.key] ?? c.name} onChange={(e) => setNames({ ...names, [c.key]: e.target.value })} aria-label="Course name" />{c.code && <span className="chip">{c.code}</span>}{c.section && <span className="chip">{c.section}</span>}</div>
                  <div className="small faint">{c.slots.map((s) => `${DAYS[s.day].slice(0, 3)} ${hm(s.start)}–${hm(s.end)}${s.room ? " " + s.room : ""}`).join("  ·  ")}{c.instructor ? `  ·  ${c.instructor}` : ""}</div>
                </div>
              </div>
            ))}
            {list.length === 0 && <p className="small faint" style={{ padding: 16 }}>No courses match.</p>}
          </div>
          <p className="small faint">Names are editable here; times, rooms and days can be corrected afterwards by clicking any class in the timetable.</p>
        </>
      )}
    </Modal>
  );
}

// ── Calendar ─────────────────────────────────────────────────────────────────
function Month() {
  const [cursor, setCursor] = useState(() => new Date());
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1), gridStart = weekStart(first);
  const end = addDays(gridStart, 41);
  const items = useRows<any>(`SELECT 'deadline' src, d.id, d.title, substr(d.due_at, 1, 10) date, d.kind, d.done, c.color FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE substr(d.due_at, 1, 10) BETWEEN ?1 AND ?2
    UNION ALL SELECT 'milestone', m.id, p.name || ': ' || m.title, m.date, 'milestone', m.done, p.color FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.date BETWEEN ?1 AND ?2
    UNION ALL SELECT 'task', t.id, t.title, t.due_date, 'task', t.status = 'done', p.color FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.due_date BETWEEN ?1 AND ?2
    UNION ALL SELECT 'study', s.id, 'Study session', s.date, 'study', s.done, NULL FROM study_sessions s WHERE s.date BETWEEN ?1 AND ?2 ORDER BY date`, [ymd(gridStart), ymd(end)]);
  const t = today();
  return (
    <div className="col gap4">
      <div className="row"><button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))} aria-label="Previous month"><Icon name="chevL" size={16} /></button><button className="btn sm" onClick={() => setCursor(new Date())}>This month</button><button className="icon-btn" onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))} aria-label="Next month"><Icon name="chevR" size={16} /></button><h2 className="display" style={{ fontSize: 30, marginLeft: 10 }}>{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</h2></div>
      <div className="plate" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", overflow: "hidden" }}>
        {DAYS.map((d) => <span key={d} className="label" style={{ padding: "10px 12px" }}>{d.slice(0, 3)}</span>)}
        {Array.from({ length: 42 }, (_, i) => { const d = addDays(gridStart, i), key = ymd(d), mine = items.filter((x) => x.date === key), out = d.getMonth() !== cursor.getMonth(); return (
          <div key={key} className="reveal-host" style={{ minHeight: 96, padding: "7px 8px", borderTop: "1px solid var(--line)", borderLeft: i % 7 ? "1px solid var(--line)" : "none", opacity: out ? 0.38 : 1, background: key === t ? "color-mix(in srgb, var(--hue) 7%, transparent)" : undefined, cursor: "pointer" }} onDoubleClick={() => useUI.getState().set({ quick: { type: "deadline", init: { due_at: key + "T23:59" } } })} title="Double-click to add a deadline on this day">
            <span className={"mono small num " + (key === t ? "hue" : "faint")}>{d.getDate()}</span>
            <div className="col" style={{ gap: 3, marginTop: 4 }}>{mine.slice(0, 4).map((x) => <button key={x.src + x.id} className="row" style={{ gap: 5, fontSize: 10.5, textAlign: "left", opacity: x.done ? 0.45 : 1 }} onClick={() => x.src === "deadline" && useUI.getState().set({ quick: { type: "deadline", init: { id: x.id } } })} title={x.title}><i className="dot" style={{ "--c": x.color ?? KIND_TONE[x.kind] ?? "var(--ink-3)", width: 5, height: 5 } as any} /><span className="truncate" style={{ textDecoration: x.done ? "line-through" : undefined }}>{x.title}</span></button>)}{mine.length > 4 && <span className="faint" style={{ fontSize: 10 }}>+{mine.length - 4} more</span>}</div>
          </div>); })}
      </div>
      <p className="small faint">Shows deadlines, project milestones, dated tasks and study sessions. Double-click a day to add a deadline.</p>
    </div>
  );
}

// ── Deadlines ────────────────────────────────────────────────────────────────
function Deadlines({ filter, clear }: { filter: { range?: string; kind?: string }; clear: () => void }) {
  const [show, setShow] = useState<"open" | "done">("open");
  const rows = useRows<any>(`SELECT d.*, c.name course, c.color FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = ? ORDER BY d.due_at ${show === "done" ? "DESC" : ""} LIMIT 300`, [show === "done" ? 1 : 0]);
  const limit = filter.range === "today" ? 1 : filter.range === "week" ? 7 - dow(new Date()) : filter.range === "month" ? 31 : null;
  const list = rows.filter((d) => (!filter.kind || d.kind === filter.kind) && (limit == null || (daysUntil(d.due_at) <= limit && daysUntil(d.due_at) >= 0)));
  const groups = useMemo(() => { const g = new Map<string, any[]>(); for (const d of list) { const n = daysUntil(d.due_at); const k = show === "done" ? "Completed" : n < 0 ? "Past due" : n === 0 ? "Today" : n <= 7 - dow(new Date()) ? "This week" : n <= 14 - dow(new Date()) ? "Next week" : "Later"; g.set(k, [...(g.get(k) ?? []), d]); } return [...g.entries()]; }, [list, show]);
  const sameDay = new Map<string, number>(); for (const d of rows) if (!["reminder", "event"].includes(d.kind)) sameDay.set(d.due_at.slice(0, 10), (sameDay.get(d.due_at.slice(0, 10)) ?? 0) + 1);
  return (
    <div className="col gap4" style={{ maxWidth: 900 }}>
      <div className="row between"><Seg value={show} onChange={setShow} options={[{ value: "open", label: "Open" }, { value: "done", label: "Completed" }]} />{(filter.range || filter.kind) && <button className="chip on" onClick={clear}>{filter.kind ?? "everything"} due {filter.range === "today" ? "today" : "this " + filter.range}<Icon name="x" size={10} /></button>}</div>
      {list.length === 0 && <Empty icon="flag" title={show === "open" ? "Nothing due" : "Nothing completed yet"} action={show === "open" ? <button className="btn primary" onClick={() => useUI.getState().set({ quick: { type: "deadline" } })}>Add a deadline</button> : undefined}>Add assignments, quizzes, exams, lab submissions and reminders — or type “quiz ML friday 3pm” into the command bar (Ctrl K).</Empty>}
      {groups.map(([name, items]) => (
        <section key={name}><div className={"label " + (name === "Past due" ? "bad" : "")} style={{ marginBottom: 6 }}>{name} · {items.length}</div>
          <div className="plate" style={{ padding: 6 }}>{items.map((d) => { const n = daysUntil(d.due_at); return (
            <div key={d.id} className="list-row" style={{ cursor: "pointer" }} onClick={() => useUI.getState().set({ quick: { type: "deadline", init: { id: d.id } } })}>
              <Check on={!!d.done} onChange={(v) => { void run("UPDATE deadlines SET done = ?, done_at = ? WHERE id = ?", [v ? 1 : 0, v ? Date.now() : null, d.id]); if (v) void log("academy", "done", `Completed: ${d.title}`, { type: "deadline", id: d.id }); }} />
              <span className="chip tint" style={{ "--c": KIND_TONE[d.kind], width: 96, justifyContent: "center" } as any}>{d.kind}</span>
              <div className="col grow" style={{ gap: 0 }}><span className="truncate" style={{ textDecoration: d.done ? "line-through" : undefined }}>{d.title}</span><span className="small faint truncate">{d.course ?? "No course"}{d.est_hours ? ` · ~${d.est_hours}h` : ""}{d.notes ? ` · ${d.notes}` : ""}</span></div>
              {!d.done && (sameDay.get(d.due_at.slice(0, 10)) ?? 0) > 1 && <span className="chip tint" style={{ "--c": "var(--warn)" } as any} title="Another submission is due the same day">shares the day</span>}
              {d.priority === 3 && <span className="chip tint" style={{ "--c": "var(--bad)" } as any}>high</span>}
              <div className="col" style={{ gap: 0, textAlign: "right", width: 120 }}><span className="small">{fmtDate(d.due_at)} · {d.due_at.slice(11)}</span><span className={"small " + (d.done ? "faint" : n < 0 ? "bad" : n <= 2 ? "warn" : "faint")}>{d.done ? "done" : relDay(d.due_at)}</span></div>
            </div>); })}</div>
        </section>
      ))}
    </div>
  );
}

// ── Courses ──────────────────────────────────────────────────────────────────
function Courses({ selected, select }: { selected: number | null; select: (id: number | null) => void }) {
  const set = useUI((s) => s.set);
  const courses = useRows<any>("SELECT c.*, (SELECT COUNT(*) FROM class_slots s WHERE s.course_id = c.id) classes, (SELECT COUNT(*) FROM deadlines d WHERE d.course_id = c.id AND d.done = 0) open, (SELECT COUNT(*) FROM links l WHERE l.b_type = 'course' AND l.b_id = c.id) files, (SELECT MIN(due_at) FROM deadlines d WHERE d.course_id = c.id AND d.done = 0) next FROM courses c WHERE c.archived = 0 ORDER BY c.name");
  const c = courses.find((x) => x.id === selected);
  if (!courses.length) return <Empty icon="academy" title="No courses yet" action={<button className="btn primary" onClick={() => set({ quick: { type: "course" } })}>Add a course</button>}>Courses are created automatically when you import a timetable, or you can add them by hand. Each one becomes a workspace for its notes, files, deadlines and exams.</Empty>;
  if (c) return <CourseSpace c={c} back={() => select(null)} />;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }} className="stagger">
      {courses.map((c) => (
        <button key={c.id} className="plate hover lit" style={{ padding: 18, textAlign: "left", "--hue": c.color } as any} onClick={() => select(c.id)}>
          <div className="row between"><span className="label" style={{ color: c.color }}>{c.code || "Course"}</span><span className="small faint">{c.progress}%</span></div>
          <h3 className="display" style={{ fontSize: 26, margin: "10px 0 4px" }}>{c.name}</h3>
          <div className="small faint truncate">{c.instructor || "Instructor not set"}</div>
          <div className="bar" style={{ margin: "14px 0 12px" }}><i style={{ width: c.progress + "%" }} /></div>
          <div className="row gap3 small dim"><span>{plural(c.classes, "class", "classes")}/wk</span><span>{c.open} open</span><span>{plural(c.files, "file")}</span>{c.next && <span className="hue" style={{ marginLeft: "auto" }}>next {relDay(c.next)}</span>}</div>
        </button>
      ))}
    </div>
  );
}

function CourseSpace({ c, back }: { c: any; back: () => void }) {
  const set = useUI((s) => s.set);
  const slots = useRows<any>("SELECT * FROM class_slots WHERE course_id = ? ORDER BY day, start_min", [c.id]);
  const deadlines = useRows<any>("SELECT * FROM deadlines WHERE course_id = ? ORDER BY done, due_at", [c.id]);
  const projects = useRows<any>("SELECT id, name, color FROM projects WHERE course_id = ?", [c.id]);
  const note = useRows<any>("SELECT * FROM notes WHERE owner_type = 'course' AND owner_id = ? LIMIT 1", [c.id])[0];
  const [body, setBody] = useState<string | null>(null);
  useEffect(() => setBody(null), [c.id]);
  const saveNote = async () => { if (body == null) return; const now = Date.now(); if (note) await run("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?", [body, now, note.id]); else if (body.trim()) await run("INSERT INTO notes(owner_type, owner_id, title, body, created_at, updated_at) VALUES('course', ?, 'Notes', ?, ?, ?)", [c.id, body, now, now]); };
  const exams = deadlines.filter((d) => d.kind === "exam" || d.kind === "quiz");
  return (
    <div className="col gap5" style={{ "--hue": c.color } as any}>
      <div className="row between gap4" style={{ alignItems: "flex-end" }}>
        <div className="col gap1"><button className="row small faint" onClick={back}><Icon name="chevL" size={13} />All courses</button><span className="label hue">{c.code}</span><h2 className="display" style={{ fontSize: 44 }}>{c.name}</h2><span className="dim">{c.instructor}{c.credits ? ` · ${c.credits} credit hours` : ""}</span></div>
        <div className="row"><button className="btn" onClick={() => set({ quick: { type: "course", init: { id: c.id } } })}><Icon name="edit" size={14} />Edit</button><button className="btn" onClick={() => set({ quick: { type: "deadline", init: { course_id: c.id } } })}><Icon name="flag" size={14} />Deadline</button><Confirm className="btn ghost danger" label="Archive" icon="archive" onConfirm={() => { void run("UPDATE courses SET archived = 1 WHERE id = ?", [c.id]); back(); }} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1.25fr 1fr", gap: 28 }}>
        <div className="col gap5">
          <div className="plate pad lit"><LinkedFiles type="course" id={c.id} /></div>
          <div className="col gap1"><span className="label">Lecture & revision notes</span><textarea className="textarea" rows={9} value={body ?? note?.body ?? ""} onChange={(e) => setBody(e.target.value)} onBlur={saveNote} placeholder="Notes for this course. Saved on this computer when you click away." /></div>
        </div>
        <div className="col gap5">
          <div className="col gap1"><div className="row between"><span className="label">Progress through the syllabus</span><span className="small num">{c.progress}%</span></div><input type="range" min={0} max={100} step={5} value={c.progress} onChange={(e) => run("UPDATE courses SET progress = ? WHERE id = ?", [+e.target.value, c.id])} style={{ accentColor: c.color }} aria-label="Course progress" /><span className="small faint">Set by you — a simple marker of how far through the material you are.</span></div>
          <div className="col gap1"><span className="label">Class times</span>{slots.length ? slots.map((s) => <div key={s.id} className="row between small"><span>{DAYS[s.day]} · {hm(s.start_min)}–{hm(s.end_min)}</span><span className="faint">{s.kind}{s.room ? ` · ${s.room}` : ""}</span></div>) : <span className="small faint">No classes scheduled. Add them from the Timetable tab.</span>}</div>
          <div className="col gap1"><span className="label">Exams & quizzes</span>{exams.length ? exams.map((d) => <div key={d.id} className="row between small" style={{ opacity: d.done ? 0.5 : 1 }}><span>{d.title}</span><span className="faint">{fmtDate(d.due_at)} · {d.due_at.slice(11)}</span></div>) : <span className="small faint">None scheduled.</span>}</div>
          <div className="col gap1"><span className="label">Assignments, labs & other work</span>{deadlines.filter((d) => !exams.includes(d)).length ? deadlines.filter((d) => !exams.includes(d)).map((d) => <div key={d.id} className="row small"><Check on={!!d.done} onChange={(v) => run("UPDATE deadlines SET done = ?, done_at = ? WHERE id = ?", [v ? 1 : 0, v ? Date.now() : null, d.id])} /><button className="grow truncate" style={{ textAlign: "left", textDecoration: d.done ? "line-through" : undefined }} onClick={() => set({ quick: { type: "deadline", init: { id: d.id } } })}>{d.title}</button><span className="faint">{d.done ? "done" : relDay(d.due_at)}</span></div>) : <span className="small faint">Nothing yet.</span>}</div>
          {projects.length > 0 && <div className="col gap1"><span className="label">Projects</span><div className="row wrap gap1">{projects.map((p) => <button key={p.id} className="chip tint" style={{ "--c": p.color } as any} onClick={() => useUI.getState().go("projects", { id: p.id })}>{p.name}</button>)}</div></div>}
        </div>
      </div>
    </div>
  );
}

// ── Prompt library ───────────────────────────────────────────────────────────
function Prompts() {
  const set = useUI((s) => s.set);
  const prompts = useRows<any>("SELECT * FROM prompts ORDER BY builtin DESC, id");
  const [subject, setSubject] = useState("General");
  const [edit, setEdit] = useState<any>(null);
  const subjects = [...new Set([...SUBJECTS, ...prompts.map((p) => p.subject)])];
  const save = () => attempt(async () => {
    if (!edit.title.trim() || !edit.body.trim()) throw new Error("A prompt needs a title and a body.");
    if (edit.id) await run("UPDATE prompts SET title=?, body=?, subject=?, updated_at=? WHERE id=?", [edit.title, edit.body, edit.subject, Date.now(), edit.id]);
    else await run("INSERT INTO prompts(title, body, subject, updated_at) VALUES(?,?,?,?)", [edit.title, edit.body, edit.subject, Date.now()]);
    setSubject(edit.subject); setEdit(null);
  });
  return (
    <div style={{ display: "grid", gridTemplateColumns: "210px 1fr", gap: 30 }}>
      <div className="col" style={{ gap: 2 }}>
        {subjects.map((s) => <button key={s} className={"list-row small" + (s === subject ? " on" : "")} style={{ textAlign: "left" }} onClick={() => setSubject(s)}><span className="grow">{s}</span><span className="faint num">{prompts.filter((p) => p.subject === s).length}</span></button>)}
        <button className="btn sm" style={{ marginTop: 12 }} onClick={() => setEdit({ title: "", body: "", subject })}><Icon name="plus" size={13} />New prompt</button>
        <p className="small faint" style={{ marginTop: 12 }}>Select files anywhere, choose a prompt, and hand both to ChatGPT or Claude. No API key is involved.</p>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 12, alignContent: "start" }}>
        {prompts.filter((p) => p.subject === subject).map((p) => (
          <div key={p.id} className="plate hover col" style={{ padding: 16, gap: 8 }}>
            <div className="row between gap3"><b>{p.title}</b>{p.uses > 0 && <span className="small faint">used {p.uses}×</span>}</div>
            <p className="small dim clamp3" style={{ whiteSpace: "pre-line" }}>{p.body}</p>
            <div className="row gap1" style={{ marginTop: "auto", paddingTop: 6 }}>
              <button className="btn sm primary" onClick={() => set({ handoff: { fileIds: [], promptId: p.id } })}><Icon name="send" size={12} />Use</button>
              <button className="btn sm ghost" onClick={() => setEdit(p)}><Icon name="edit" size={12} />Edit</button>
              <button className="btn sm ghost" onClick={() => setEdit({ title: p.title + " (copy)", body: p.body, subject: p.subject })}><Icon name="duplicate" size={12} />Duplicate</button>
              <span className="grow" /><Confirm onConfirm={() => run("DELETE FROM prompts WHERE id = ?", [p.id])} />
            </div>
          </div>
        ))}
        {prompts.filter((p) => p.subject === subject).length === 0 && <Empty icon="spark" title="No prompts in this collection">Create one with “New prompt”.</Empty>}
      </div>
      {edit && <Modal title={edit.id ? "Edit prompt" : "New prompt"} onClose={() => setEdit(null)} wide foot={<><button className="btn ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn primary" onClick={save}>Save prompt</button></>}>
        <div className="grid2"><Field label="Title"><input className="input" autoFocus value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></Field><Field label="Collection"><input className="input" list="pu-subjects" value={edit.subject} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} /><datalist id="pu-subjects">{subjects.map((s) => <option key={s} value={s} />)}</datalist></Field></div>
        <Field label="Prompt" hint="Refer to “the attached material” — files are attached by you at handoff."><textarea className="textarea" rows={12} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></Field>
      </Modal>}
    </div>
  );
}
