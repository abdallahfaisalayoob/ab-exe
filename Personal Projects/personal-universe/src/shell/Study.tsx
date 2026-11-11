// Study sessions: plan a sitting of several subjects (each with its own minutes and intent),
// start it now or later, and let ORION run the clock — work, breaks, and the classes in between.
import { useEffect, useMemo, useState } from "react";
import { create } from "zustand";
import { batch, log, native, q, run } from "../lib/backend";
import { dow, fmtDate, hm, parseHm, today, ymd } from "../lib/dates";
import { useCourseFocus, useNow, useRows, useSetting, useSettings } from "../lib/hooks";
import { speak } from "../lib/orion";
import { fmtMin, layout, RHYTHMS, rhythmOf, spans, suggest, summarise, type Busy, type Segment } from "../lib/study";
import { attempt, toast, useUI } from "../lib/store";
import { Icon } from "../ui/Icons";
import { Check, Confirm, Field, Modal, Ring, Seg } from "../ui/kit";

const BREAK_IDEAS = ["Stand up and stretch.", "Drink some water.", "Look at something far away for twenty seconds.", "Walk around for a few minutes.", "Step away from the screen.", "Breathe slowly for a minute."];
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };

async function classesOn(date: string): Promise<Busy[]> {
  const d = new Date(date + "T12:00");
  const rows = await q<any>("SELECT s.start_min, s.end_min, c.name FROM class_slots s JOIN courses c ON c.id = s.course_id WHERE s.day = ? AND c.archived = 0", [dow(d)]);
  return rows.map((r) => ({ start: r.start_min, end: r.end_min, label: r.name }));
}

// ── The running session ──────────────────────────────────────────────────────
interface RBlock { type: "work" | "break" | "busy"; seg: number; dur: number; absEnd?: number; label?: string }
interface RSeg { sid: number; course: string; color: string; note: string; minutes: number }
export interface Run { planId: number; blocks: RBlock[]; segs: RSeg[]; idx: number; blockStart: number; paused: number | null; extra: number; worked: number; done: boolean; open: boolean; tip: number }
export const useRun = create<{ run: Run | null }>(() => ({ run: null }));
const commit = (r: Run | null) => { useRun.setState({ run: r }); void useSettings.getState().put("study.run", r); };

function remaining(r: Run, now: number) {
  const b = r.blocks[r.idx];
  if (!b) return 0;
  if (b.type === "busy" && b.absEnd) return b.absEnd - now;
  return r.blockStart + b.dur * 1000 + r.extra - (r.paused ?? now);
}
/** Moves past every block whose time is up, even if the app was closed meanwhile. */
function catchUp(r: Run, now: number): Run | null {
  let n: Run | null = null;
  while (!r.paused && !r.done && r.idx < r.blocks.length && remaining(n ?? r, now) <= 0) {
    n = { ...(n ?? r) };
    const b = n.blocks[n.idx];
    const end = b.type === "busy" && b.absEnd ? b.absEnd : n.blockStart + b.dur * 1000 + n.extra;
    if (b.type === "work") n.worked += b.dur + n.extra / 1000;
    n.idx++; n.blockStart = end; n.extra = 0; n.tip++;
    n.open = true; // every change of activity brings the panel back into view
  }
  if (n && n.idx >= n.blocks.length) n.done = true;
  return n;
}
function announce(r: Run) {
  if (r.done) {
    const t = `Session complete. ${fmtMin(Math.round(r.worked / 60))} of study. Well done.`;
    void speak(t); void native.notify("Study session complete", t);
    return;
  }
  const b = r.blocks[r.idx], s = r.segs[b.seg];
  const next = r.blocks.slice(r.idx + 1).find((x) => x.type === "work");
  const ns = next ? r.segs[next.seg] : null;
  const t = b.type === "work" ? `Now: ${s.course}${s.note ? ". " + s.note : ""}. ${fmtMin(Math.round(b.dur / 60))}.`
    : b.type === "break" ? `Break, ${Math.round(b.dur / 60)} minutes. ${BREAK_IDEAS[r.tip % BREAK_IDEAS.length]}${ns ? ` Next: ${ns.course}.` : ""}`
    : `Pausing for ${b.label ?? "class"}. I'll pick up afterwards.`;
  void speak(t);
  if (document.hidden) void native.notify(b.type === "work" ? s.course : b.type === "break" ? "Break" : b.label ?? "Class", t);
}

export async function startPlan(planId: number) {
  if (useRun.getState().run && !useRun.getState().run!.done) return toast("A study session is already running.", "error");
  const plan = (await q<any>("SELECT * FROM study_plans WHERE id = ?", [planId]))[0];
  const rows = await q<any>("SELECT s.*, c.name, c.color FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.plan_id = ? ORDER BY s.seq", [planId]);
  if (!plan || !rows.length) return toast("That plan has no subjects.", "error");
  const date = today(), start = nowMinutes();
  const segs: Segment[] = rows.map((r) => ({ course_id: r.course_id, minutes: r.minutes || r.end_min - r.start_min, note: r.note }));
  const blocks = layout(segs, start, rhythmOf(plan.rhythm), await classesOn(date));
  const sp = spans(segs, blocks), sum = summarise(blocks)!;
  // The plan now starts from this minute: its subjects move with it.
  await batch([
    { sql: "UPDATE study_plans SET date = ?, start_min = ?, end_min = ?, state = 'running', started_at = ? WHERE id = ?", params: [date, sum.start, sum.end, Date.now(), planId] },
    ...rows.map((r, i) => ({ sql: "UPDATE study_sessions SET date = ?, start_min = ?, end_min = ? WHERE id = ?", params: [date, sp[i]?.start ?? start, sp[i]?.end ?? start, r.id] })),
  ]);
  const base = new Date(); base.setHours(0, 0, 0, 0);
  const r: Run = {
    planId, idx: 0, blockStart: Date.now(), paused: null, extra: 0, worked: 0, done: false, open: true, tip: Math.floor(Math.random() * 6),
    segs: rows.map((x) => ({ sid: x.id, course: x.name ?? "General study", color: x.color ?? "var(--hue-home)", note: x.note, minutes: x.minutes || x.end_min - x.start_min })),
    blocks: blocks.map((b) => ({ type: b.type, seg: b.seg, dur: (b.end - b.start) * 60, label: b.label, absEnd: b.type === "busy" ? base.getTime() + b.end * 60_000 : undefined })),
  };
  commit(r);
  void log("academy", "study", "Started a study session", { type: "study_plan", id: planId }, r.segs.map((s) => s.course).join(", "));
  announce(r);
}

const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`; };

/** Top-bar pill while a session runs. */
export function StudyChip() {
  const r = useRun((s) => s.run);
  const now = useNow(1000).getTime();
  if (!r) return null;
  const b = r.blocks[r.idx], seg = b ? r.segs[b.seg] : null;
  const label = r.done ? "Session done" : b.type === "work" ? seg!.course : b.type === "break" ? "Break" : b.label ?? "Class";
  return (
    <button className="chip tint" style={{ "--c": r.done || b.type !== "work" ? "var(--hue-home)" : seg!.color, height: 26 } as any} onClick={() => commit({ ...r, open: !r.open })} title="Study session">
      <Icon name={r.done ? "check" : r.paused ? "min" : b.type === "break" ? "home" : "book"} size={12} />
      {!r.done && <span className="mono num">{mmss(remaining(r, now))}</span>}
      <span className="truncate" style={{ maxWidth: 130 }}>{label}</span>
    </button>
  );
}

/** The session panel, the clock that drives it, and the "time to start" nudge for scheduled plans. */
export function StudyPanel() {
  const r = useRun((s) => s.run);
  const loaded = useSettings((s) => s.loaded);
  const now = useNow(1000).getTime();
  const [marks, setMarks] = useState<Record<number, boolean> | null>(null);

  useEffect(() => { if (loaded && !useRun.getState().run) { const saved = useSettings.getState().values["study.run"]; if (saved) useRun.setState({ run: saved }); } }, [loaded]);
  useEffect(() => {
    if (!r) return;
    const n = catchUp(r, now);
    if (n) { commit(n); announce(n); }
  }, [now, r]);
  useEffect(() => { if (r?.done && !marks) setMarks(Object.fromEntries(r.segs.map((s, i) => [s.sid, segFinished(r, i)]))); if (!r) setMarks(null); }, [r?.done, r]);

  // Scheduled plans: a nudge when it is time to begin.
  useEffect(() => {
    const t = setInterval(async () => {
      if (useRun.getState().run) return;
      const nm = nowMinutes();
      const due = await q<any>("SELECT p.id, p.start_min, (SELECT GROUP_CONCAT(COALESCE(c.name, 'General study'), ', ') FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.plan_id = p.id) subjects FROM study_plans p WHERE p.date = ? AND p.state = 'planned' AND p.start_min <= ? AND p.start_min > ?", [today(), nm, nm - 20]).catch(() => []);
      for (const p of due) {
        const key = `study:${p.id}:${p.start_min}`;
        if (nudged.has(key)) continue;
        nudged.add(key);
        const msg = `Time to study: ${p.subjects}.`;
        toast(msg, "info", { label: "Start now", run: () => void startPlan(p.id) });
        void speak(`It is ${hm(p.start_min)}. ${msg}`);
        void native.notify("Study session", msg);
      }
    }, 20_000);
    return () => clearInterval(t);
  }, []);

  if (!r || !r.open) return null;
  const b = r.blocks[r.idx], seg = b ? r.segs[b.seg] : null;
  const left = b ? remaining(r, now) : 0;
  const total = b ? (b.type === "busy" && b.absEnd ? b.absEnd - r.blockStart : b.dur * 1000 + r.extra) : 1;
  const nextWork = r.blocks.slice(r.idx + 1).find((x) => x.type === "work");
  const workedNow = r.worked + (b?.type === "work" ? Math.max(0, (r.paused ?? now) - r.blockStart) / 1000 : 0);
  const finish = () => commit({ ...r, worked: workedNow, done: true, paused: null });

  if (r.done) {
    const m = marks ?? {};
    const save = () => attempt(async () => {
      const min = Math.round(r.worked / 60);
      await batch([
        ...r.segs.map((s) => ({ sql: "UPDATE study_sessions SET done = ? WHERE id = ?", params: [m[s.sid] ? 1 : 0, s.sid] })),
        { sql: "UPDATE study_plans SET state = 'done', ended_at = ?, studied_min = ? WHERE id = ?", params: [Date.now(), min, r.planId] },
      ]);
      if (min > 0) await log("academy", "focus", `Studied for ${min} minutes`, { type: "study_plan", id: r.planId }, r.segs.filter((s) => m[s.sid]).map((s) => s.course).join(", "));
      commit(null);
      useUI.getState().bump();
    }, "Session saved.");
    return (
      <aside className="study-panel">
        <span className="label hue">Session complete</span>
        <h3 className="display" style={{ fontSize: 30, margin: "6px 0 2px" }}>{fmtMin(Math.round(r.worked / 60))} studied</h3>
        <span className="small dim">Tick what you got through — it shows up in your wrap-up and the planner.</span>
        <div className="col" style={{ gap: 2, margin: "12px -8px" }}>
          {r.segs.map((s) => (
            <label key={s.sid} className="list-row" style={{ alignItems: "flex-start" }}>
              <Check on={!!m[s.sid]} onChange={(v) => setMarks({ ...m, [s.sid]: v })} label={s.course} />
              <div className="col grow" style={{ gap: 0 }}><span className="row gap1"><i className="dot" style={{ "--c": s.color } as any} />{s.course} <span className="faint small">· {fmtMin(s.minutes)}</span></span>{s.note && <span className="small faint">{s.note}</span>}</div>
            </label>
          ))}
        </div>
        <div className="row" style={{ justifyContent: "flex-end" }}><button className="btn ghost sm" onClick={() => commit({ ...r, open: false })}>Later</button><button className="btn primary sm" onClick={save}>Save</button></div>
      </aside>
    );
  }

  const colour = b.type === "work" ? seg!.color : b.type === "break" ? "var(--good)" : "var(--ink-3)";
  return (
    <aside className="study-panel" style={{ "--c": colour } as any}>
      <div className="row between"><span className="label" style={{ color: colour }}>{b.type === "work" ? `Studying · ${r.segs.findIndex((_, i) => i === b.seg) + 1} of ${r.segs.length}` : b.type === "break" ? "Break" : "Class"}{r.paused ? " · paused" : ""}</span><button className="icon-btn sm" onClick={() => commit({ ...r, open: false })} aria-label="Hide"><Icon name="min" size={13} /></button></div>
      <div className="row gap4" style={{ margin: "12px 0 6px", alignItems: "center" }}>
        <Ring value={1 - left / Math.max(1, total)} size={112} stroke={6} color={colour}><span className="mono num" style={{ fontSize: 22 }}>{mmss(left)}</span></Ring>
        <div className="col grow" style={{ gap: 3, minWidth: 0 }}>
          <span className="display" style={{ fontSize: 26, lineHeight: 1.05 }}>{b.type === "work" ? seg!.course : b.type === "break" ? "Take a breather" : b.label}</span>
          <span className="small dim">{b.type === "work" ? seg!.note || "No description — just this subject." : b.type === "break" ? BREAK_IDEAS[r.tip % BREAK_IDEAS.length] : "Your study session picks up after class."}</span>
        </div>
      </div>
      {nextWork && b.type !== "work" && <span className="small faint">Next: <b style={{ color: "var(--ink)" }}>{r.segs[nextWork.seg].course}</b>{r.segs[nextWork.seg].note ? ` — ${r.segs[nextWork.seg].note}` : ""}</span>}
      <div className="row" style={{ gap: 2, margin: "12px 0" }}>{r.blocks.map((x, i) => <span key={i} title={x.type === "work" ? r.segs[x.seg].course : x.type} style={{ flex: Math.max(1, x.dur), height: 6, borderRadius: 3, background: x.type === "work" ? r.segs[x.seg].color : x.type === "break" ? "var(--plate-3)" : "repeating-linear-gradient(45deg, var(--ink-4) 0 3px, transparent 3px 6px)", opacity: i < r.idx ? 0.3 : 1, outline: i === r.idx ? "1.5px solid var(--ink)" : "none", outlineOffset: 1 }} />)}</div>
      <div className="row gap1 wrap">
        {b.type !== "busy" && (r.paused
          ? <button className="btn sm primary" onClick={() => commit({ ...r, blockStart: r.blockStart + (Date.now() - r.paused!), paused: null })}><Icon name="play" size={12} />Resume</button>
          : <button className="btn sm" onClick={() => commit({ ...r, paused: Date.now() })}><Icon name="min" size={12} />Pause</button>)}
        {b.type !== "busy" && <button className="btn sm ghost" onClick={() => commit({ ...r, extra: r.extra + 5 * 60_000 })}>+5 min</button>}
        <button className="btn sm ghost" onClick={() => { const n = { ...r, worked: workedNow, idx: r.idx + 1, blockStart: Date.now(), extra: 0, paused: null, tip: r.tip + 1 }; if (n.idx >= n.blocks.length) n.done = true; commit(n); announce(n); }}>{b.type === "break" ? "Skip break" : "Skip"}</button>
        <span className="grow" />
        <Confirm className="btn sm ghost danger" label="End session" icon="x" onConfirm={finish} />
      </div>
    </aside>
  );
}
const nudged = new Set<string>();
function segFinished(r: Run, i: number) {
  const last = r.blocks.map((b, k) => (b.type === "work" && b.seg === i ? k : -1)).filter((k) => k >= 0).pop();
  return last != null && last < r.idx;
}

// ── Planning ─────────────────────────────────────────────────────────────────
interface Row extends Segment { key: number }
let keySeq = 1;
const blank = (course_id: number | null, minutes = 60): Row => ({ key: keySeq++, course_id, minutes, note: "", deadline_id: null });
const nextQuarter = () => { const m = nowMinutes() + 15; return hm(Math.min(23 * 60 + 45, Math.ceil(m / 15) * 15)); };

export function StudyDialog({ init, close }: { init?: any; close: () => void }) {
  const courses = useRows<any>("SELECT id, name, code, color FROM courses WHERE archived = 0 ORDER BY name");
  const deadlines = useRows<any>("SELECT d.*, c.name course FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = 0 AND d.kind NOT IN ('event', 'reminder') ORDER BY d.due_at");
  const [focus] = useCourseFocus();
  const [rhythmId, setRhythmId] = useSetting("study.rhythm", "50-10");
  const [when, setWhen] = useState<"now" | "later">(init?.start || (init?.planId && !init?.now) ? "later" : "now");
  const [date, setDate] = useState<string>(init?.date ?? today());
  const [start, setStart] = useState<string>(init?.start ?? nextQuarter());
  const [rows, setRows] = useState<Row[]>(() => [blank(focus?.id ?? null, init?.total ?? 60)]);
  const [busy, setBusy] = useState<Busy[]>([]);
  const [primed, setPrimed] = useState(false);
  useNow(30_000);
  const nowMin = nowMinutes();
  const day = when === "now" ? today() : date;

  useEffect(() => { void classesOn(day).then(setBusy); }, [day]);
  // Editing: load the plan. "Plan my next 3 hours": prefill from deadlines once they have loaded.
  useEffect(() => {
    if (primed) return;
    if (init?.planId) {
      void (async () => {
        const p = (await q<any>("SELECT * FROM study_plans WHERE id = ?", [init.planId]))[0];
        const s = await q<any>("SELECT * FROM study_sessions WHERE plan_id = ? ORDER BY seq", [init.planId]);
        if (p) { setDate(p.date); setStart(hm(p.start_min)); setRhythmId(p.rhythm); }
        setRows(s.map((x) => ({ key: keySeq++, course_id: x.course_id, minutes: x.minutes || x.end_min - x.start_min, note: x.note, deadline_id: x.deadline_id })));
      })();
      setPrimed(true);
    } else if (init?.total && deadlines.length) {
      const sug = suggest(deadlines, init.total);
      if (sug.length) setRows(sug.map((s) => ({ ...s, key: keySeq++ })));
      setPrimed(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deadlines.length]);

  const rhythm = rhythmOf(rhythmId);
  const startMin = when === "now" ? nowMin : parseHm(start);
  const active = rows.filter((r) => r.minutes > 0);
  const blocks = useMemo(() => layout(active, startMin, rhythm, busy), [JSON.stringify(active), startMin, rhythmId, busy]);
  const sum = summarise(blocks);
  const colour = (cid: number | null) => courses.find((c) => c.id === cid)?.color ?? "var(--ink-3)";
  const set = (key: number, patch: Partial<Row>) => setRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const save = (go: boolean) => attempt(async () => {
    if (!active.length) throw new Error("Add at least one subject with some minutes.");
    const vague = active.find((r) => !r.course_id && !r.note.trim());
    if (vague) throw new Error("For general study, say what you will do.");
    const d = go ? today() : date, s0 = go ? nowMinutes() : parseHm(start);
    const bl = layout(active, s0, rhythm, await classesOn(d)), sp = spans(active, bl), sm = summarise(bl)!;
    let id = init?.planId as number | undefined;
    if (id) {
      await batch([{ sql: "UPDATE study_plans SET date = ?, start_min = ?, end_min = ?, rhythm = ?, state = 'planned' WHERE id = ?", params: [d, sm.start, sm.end, rhythm.id, id] }, { sql: "DELETE FROM study_sessions WHERE plan_id = ?", params: [id] }]);
    } else id = (await run("INSERT INTO study_plans(date, start_min, end_min, rhythm, created_at) VALUES(?,?,?,?,?)", [d, sm.start, sm.end, rhythm.id, Date.now()])).lastId;
    await batch(active.map((r, i) => ({ sql: "INSERT INTO study_sessions(course_id, deadline_id, date, start_min, end_min, note, plan_id, seq, minutes) VALUES(?,?,?,?,?,?,?,?,?)", params: [r.course_id, r.deadline_id ?? null, d, sp[i]!.start, sp[i]!.end, r.note.trim(), id!, i, r.minutes] })));
    if (!init?.planId) void log("academy", "plan", `Planned ${fmtMin(sm.work)} of study`, { type: "study_plan", id }, active.map((r) => courses.find((c) => c.id === r.course_id)?.name ?? "General study").join(", "));
    close();
    if (go) await startPlan(id!);
    else toast(`Study planned for ${fmtDate(d)} at ${hm(sm.start)} — ${fmtMin(sm.work)}. I'll remind you when it's time.`, "good");
  });

  const span = sum ? sum.end - sum.start : 1;
  const past = when === "later" && date === today() && parseHm(start) < nowMinutes();
  return (
    <Modal title={init?.planId ? "Edit study session" : "Plan a study session"} sub="Several subjects in one sitting — each with its own time and what you'll do." onClose={close} wide
      foot={<>
        {init?.planId && <Confirm className="btn ghost danger" label="Delete plan" onConfirm={() => attempt(async () => { await run("DELETE FROM study_plans WHERE id = ?", [init.planId]); close(); })} />}
        <span className="grow" />
        <button className="btn ghost" onClick={close}>Cancel</button>
        {when === "now" ? <button className="btn primary" onClick={() => save(true)}><Icon name="play" size={13} />Start now</button>
          : <button className="btn primary" onClick={() => save(false)}><Icon name="calendar" size={13} />Schedule for {hm(parseHm(start))}</button>}
      </>}>
      <div className="row between wrap gap3">
        <Seg value={when} onChange={setWhen} options={[{ value: "now", label: "Start now" }, { value: "later", label: "Later" }]} />
        {when === "later" && <div className="row gap1"><input className="input" type="date" style={{ width: 150 }} value={date} onChange={(e) => setDate(e.target.value)} aria-label="Date" /><input className="input" type="time" style={{ width: 110 }} value={start} onChange={(e) => setStart(e.target.value)} aria-label="Start time" /></div>}
        <span className="grow" />
        <button className="btn sm ghost" onClick={() => { const s = suggest(deadlines, active.reduce((n, r) => n + r.minutes, 0) || 120); if (s.length) setRows(s.map((x) => ({ ...x, key: keySeq++ }))); else toast("No upcoming deadlines linked to a course — add subjects yourself."); }}><Icon name="spark" size={13} />Suggest from my deadlines</button>
      </div>

      <div className="col gap3">
        {rows.map((r, i) => {
          const options = deadlines.filter((d) => !r.course_id || d.course_id === r.course_id);
          return (
            <div key={r.key} className="plate" style={{ padding: "12px 14px", borderLeft: `3px solid ${colour(r.course_id)}` }}>
              <div className="row gap3 wrap">
                <span className="mono faint small" style={{ width: 16 }}>{i + 1}</span>
                <select className="select" style={{ width: 230 }} value={r.course_id ?? ""} onChange={(e) => set(r.key, { course_id: e.target.value ? +e.target.value : null, deadline_id: null })} aria-label="Course">
                  <option value="">General study</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code ? c.code + " · " : ""}{c.name}</option>)}
                </select>
                <div className="row gap1">
                  <button className="icon-btn sm" onClick={() => set(r.key, { minutes: Math.max(0, r.minutes - 15) })} aria-label="Less time"><Icon name="min" size={12} /></button>
                  <input className="input num" style={{ width: 64, textAlign: "center" }} type="number" min={0} step={5} value={r.minutes} onChange={(e) => set(r.key, { minutes: Math.max(0, +e.target.value || 0) })} aria-label="Minutes" />
                  <button className="icon-btn sm" onClick={() => set(r.key, { minutes: r.minutes + 15 })} aria-label="More time"><Icon name="plus" size={12} /></button>
                  <span className="small faint" style={{ width: 52 }}>{fmtMin(r.minutes)}</span>
                </div>
                <select className="select grow" style={{ minWidth: 160 }} value={r.deadline_id ?? ""} onChange={(e) => set(r.key, { deadline_id: e.target.value ? +e.target.value : null })} aria-label="Working towards">
                  <option value="">Not for a specific deadline</option>{options.map((d) => <option key={d.id} value={d.id}>{d.title} — {fmtDate(d.due_at)}</option>)}
                </select>
                {rows.length > 1 && <button className="icon-btn sm" onClick={() => setRows(rows.filter((x) => x.key !== r.key))} aria-label="Remove subject"><Icon name="x" size={13} /></button>}
              </div>
              <input className="input" style={{ marginTop: 8 }} value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} placeholder="What will you do? e.g. Re-read lecture 5, then problems 3.1–3.6" aria-label="What you will do" />
            </div>
          );
        })}
        <button className="btn sm" style={{ alignSelf: "flex-start" }} onClick={() => setRows([...rows, blank(null, 45)])}><Icon name="plus" size={13} />Add a subject</button>
      </div>

      <Field label="Breaks"><Seg value={rhythmId} onChange={setRhythmId} options={RHYTHMS.map((x) => ({ value: x.id, label: x.label }))} /></Field>
      <span className="small faint" style={{ marginTop: -8 }}>{rhythm.hint}. A short reset is added when you switch subjects.</span>

      {sum && (
        <div className="col gap1">
          <div className="row" style={{ gap: 2 }}>{blocks.map((b, i) => <span key={i} title={`${b.type === "work" ? courses.find((c) => c.id === active[b.seg]?.course_id)?.name ?? "General study" : b.type === "break" ? "Break" : b.label} · ${hm(b.start)}–${hm(b.end)}`} style={{ flex: (b.end - b.start) / span, height: 12, borderRadius: 4, background: b.type === "work" ? colour(active[b.seg]?.course_id ?? null) : b.type === "break" ? "var(--plate-3)" : "repeating-linear-gradient(45deg, var(--ink-4) 0 3px, transparent 3px 6px)" }} />)}</div>
          <div className="row between small"><span className="mono faint">{hm(sum.start % 1440)}</span><span className="dim"><b style={{ color: "var(--ink)" }}>{fmtMin(sum.work)}</b> of study · {sum.breaks ? `${sum.breaks} ${sum.breaks === 1 ? "break" : "breaks"} (${sum.breakMin} min)` : "no breaks"}{sum.busy.length ? ` · around ${sum.busy.map((b) => b.label).join(", ")}` : ""}</span><span className="mono faint">{hm(sum.end % 1440)}</span></div>
          {past && <span className="small warn">That time has already passed today — choose a later time, or start now.</span>}
          {sum.overnight && <span className="small warn">This runs past midnight. Consider splitting it across two days.</span>}
        </div>
      )}
    </Modal>
  );
}

/** Home: today's study, with one-click start. */
export function TodayStudy() {
  const set = useUI((s) => s.set);
  const r = useRun((s) => s.run);
  const day = today();
  const plans = useRows<any>("SELECT * FROM study_plans WHERE date = ? AND state != 'cancelled' ORDER BY start_min", [day]);
  const segs = useRows<any>("SELECT s.*, c.name, c.color FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.date = ? AND s.plan_id IS NOT NULL ORDER BY s.seq", [day]);
  return (
    <div className="col gap1" style={{ marginTop: 6 }}>
      <div className="row between"><span className="label">Study today</span><button className="btn sm ghost" onClick={() => set({ quick: { type: "study" } })}><Icon name="plus" size={12} />Plan study</button></div>
      {plans.length === 0 && <span className="small faint">Nothing planned. Plan a sitting of one or more subjects — start it now, or schedule it for later.</span>}
      {plans.map((p) => {
        const mine = segs.filter((s) => s.plan_id === p.id);
        const running = r && r.planId === p.id && !r.done;
        return (
          <div key={p.id} className="plate" style={{ padding: "10px 12px", opacity: p.state === "done" ? 0.6 : 1 }}>
            <div className="row between gap3">
              <span className="mono small">{hm(p.start_min)}–{hm(p.end_min % 1440)}</span>
              {p.state === "done" ? <span className="chip tint" style={{ "--c": "var(--good)" } as any}><Icon name="check" size={11} />{fmtMin(p.studied_min)} studied</span>
                : running ? <button className="chip tint" onClick={() => r && commit({ ...r, open: true })}>In progress</button>
                : <div className="row gap1"><button className="btn sm ghost" onClick={() => set({ quick: { type: "study", init: { planId: p.id } } })}>Edit</button><button className="btn sm primary" onClick={() => void startPlan(p.id)}><Icon name="play" size={11} />Start</button></div>}
            </div>
            <div className="col" style={{ gap: 3, marginTop: 6 }}>{mine.map((s) => <div key={s.id} className="row small" style={{ alignItems: "flex-start" }}><i className="dot" style={{ "--c": s.color ?? "var(--ink-3)", marginTop: 6 } as any} /><span className="grow" style={{ textDecoration: s.done ? "line-through" : undefined }}><b style={{ fontWeight: 500 }}>{s.name ?? "General study"}</b> <span className="faint">· {fmtMin(s.minutes || s.end_min - s.start_min)}</span>{s.note ? <span className="faint"> — {s.note}</span> : null}</span></div>)}</div>
          </div>
        );
      })}
    </div>
  );
}

export const studyActive = () => { const r = useRun.getState().run; return !!r && !r.done; };
