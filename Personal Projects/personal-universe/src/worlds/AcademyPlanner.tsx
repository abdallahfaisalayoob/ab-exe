// Academic workload simulator. Drag a deadline to another week to see — before changing
// anything — what it does to the rest of the semester. All numbers follow the stated rules
// in lib/workload.ts; nothing is forecast.
import { useCallback, useMemo, useState } from "react";
import { batch, log, run } from "../lib/backend";
import { DAYS, addDays, fmtDate, hm, parseHm, parseLocal, weekStart, ymd, ymdhm } from "../lib/dates";
import { plural } from "../lib/format";
import { useRows, useSetting } from "../lib/hooks";
import { attempt, useUI } from "../lib/store";
import { DEFAULT_HOURS, DEFAULT_RULES, LEAD_DAYS, effort, findClusters, freeBlocks, weekLoads, type Deadline } from "../lib/workload";
import { Icon } from "../ui/Icons";
import { Confirm, Empty, Field, Modal, useDrag } from "../ui/kit";

const LEVEL: Record<string, [string, string]> = { light: ["var(--good)", "Light"], steady: ["var(--hue)", "Steady"], heavy: ["var(--warn)", "Heavy"], over: ["var(--bad)", "Over capacity"] };
const TONE: Record<string, string> = { exam: "var(--bad)", quiz: "var(--warn)", assignment: "var(--hue-academy)", lab: "var(--hue-knowledge)", presentation: "var(--hue-projects)", milestone: "var(--hue-projects)" };

export function Planner() {
  const [rules] = useSetting("studyRules", DEFAULT_RULES);
  const r = { ...DEFAULT_RULES, ...rules };
  const real = useRows<Deadline & { course?: string }>("SELECT d.*, c.name course FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = 0 AND d.kind NOT IN ('reminder', 'event') ORDER BY d.due_at");
  const slots = useRows<any>("SELECT s.day, s.start_min, s.end_min FROM class_slots s JOIN courses c ON c.id = s.course_id WHERE c.archived = 0");
  const sessions = useRows<any>("SELECT s.*, c.name course, d.title deadline FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id LEFT JOIN deadlines d ON d.id = s.deadline_id WHERE s.date >= ? ORDER BY s.date, s.start_min", [ymd(weekStart(new Date()))]);
  const [moves, setMoves] = useState<Record<number, string>>({});
  const [week, setWeek] = useState(() => ymd(weekStart(new Date())));
  const [plan, setPlan] = useState<any>(null);

  const now = useMemo(() => new Date(), []);
  const sim = useMemo(() => real.map((d) => (moves[d.id] ? { ...d, due_at: moves[d.id] } : d)), [real, moves]);
  const count = useMemo(() => { const last = [...real.map((d) => d.due_at), ...Object.values(moves)].sort().at(-1); const n = last ? Math.ceil((parseLocal(last).getTime() - weekStart(now).getTime()) / (7 * 86400000)) + 2 : 8; return Math.max(8, Math.min(22, n)); }, [real, moves, now]);
  const base = useMemo(() => weekLoads(real, slots, r, now, count, now), [real, slots, r.studyPerDay, r.dayStart, r.dayEnd, count]);
  const weeks = useMemo(() => weekLoads(sim, slots, r, now, count, now), [sim, slots, r.studyPerDay, r.dayStart, r.dayEnd, count]);
  const clusters = useMemo(() => findClusters(sim), [sim]);
  const changed = Object.keys(moves).length;

  const drag = useDrag<Deadline>(useCallback((d, target) => {
    const from = ymd(weekStart(parseLocal(d.due_at)));
    if (target === from || !/^\d{4}-/.test(target)) return;
    const shift = Math.round((parseLocal(target).getTime() - parseLocal(from).getTime()) / 86400000);
    const next = ymdhm(addDays(parseLocal(d.due_at), shift));
    const original = real.find((x) => x.id === d.id)?.due_at;
    setMoves((m) => { const n = { ...m }; if (next === original) delete n[d.id]; else n[d.id] = next; return n; });
  }, [real]));

  const apply = () => attempt(async () => {
    await batch(Object.entries(moves).map(([id, due]) => ({ sql: "UPDATE deadlines SET due_at = ? WHERE id = ?", params: [due, +id] })));
    void log("academy", "plan", `Rescheduled ${plural(changed, "deadline")} in the planner`);
    setMoves({});
  }, "Schedule updated.");

  if (!real.length && !slots.length) return <Empty icon="timeline" title="The planner needs something to plan" action={<button className="btn primary" onClick={() => useUI.getState().set({ quick: { type: "deadline" } })}>Add a deadline</button>}>Once you have a timetable and a few deadlines, this view shows how much preparation each week asks for against the time you actually have — and lets you try moving things before you commit.</Empty>;

  const overBefore = base.filter((w) => w.level === "over").length, overAfter = weeks.filter((w) => w.level === "over").length;
  const sel = weeks.find((w) => w.start === week) ?? weeks[0];
  const selDays = Array.from({ length: 7 }, (_, i) => addDays(parseLocal(sel.start), i));
  const maxRatio = Math.max(1.2, ...weeks.map((w) => w.ratio));
  return (
    <div className="col gap5">
      {changed > 0 && (
        <div className="plate glass row between gap4" style={{ padding: "12px 16px", borderColor: "color-mix(in srgb, var(--hue) 50%, transparent)", position: "sticky", top: 0, zIndex: 6 }}>
          <div className="col" style={{ gap: 1 }}><b>What-if: {plural(changed, "deadline")} moved</b><span className="small dim">Weeks over capacity: {overBefore} → <span className={overAfter < overBefore ? "good" : overAfter > overBefore ? "bad" : ""}>{overAfter}</span>. Nothing is saved until you apply.</span></div>
          <div className="row"><button className="btn ghost" onClick={() => setMoves({})}>Discard</button><button className="btn primary" onClick={apply}>Apply changes</button></div>
        </div>
      )}

      <div className="scroll" style={{ margin: "0 -40px", padding: "4px 40px 10px" }}>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${weeks.length}, minmax(128px, 1fr))`, gap: 8, minWidth: weeks.length * 136 }}>
          {weeks.map((w, i) => { const [color, label] = LEVEL[w.level]; const was = base[i]; const delta = w.load - was.load; return (
            <div key={w.start} data-drop={w.start} className="plate col" onClick={() => setWeek(w.start)} style={{ padding: "12px 10px 10px", gap: 8, cursor: "pointer", borderColor: w.start === sel.start ? "var(--hue)" : drag.over === w.start ? "var(--line-2)" : undefined, background: drag.over === w.start ? "var(--plate-2)" : undefined, minHeight: 300 }}>
              <div className="row between"><span className="small" style={{ fontWeight: 500 }}>{fmtDate(w.start).slice(4)}</span>{i === 0 ? <span className="label hue" style={{ fontSize: 9 }}>now</span> : <span className="label" style={{ fontSize: 9 }}>+{i}w</span>}</div>
              <div style={{ height: 92, position: "relative", borderRadius: 8, background: "var(--plate)", overflow: "hidden" }} title={`${w.load.toFixed(1)}h of preparation against ${w.capacity.toFixed(0)}h of capacity`}>
                <div style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: `${Math.min(100, (w.ratio / maxRatio) * 100)}%`, background: `linear-gradient(to top, color-mix(in srgb, ${color} 55%, transparent), color-mix(in srgb, ${color} 18%, transparent))`, borderTop: `1.5px solid ${color}`, transition: "height var(--slow) var(--ease)" }} />
                <div style={{ position: "absolute", left: 0, right: 0, bottom: `${(1 / maxRatio) * 100}%`, borderTop: "1px dashed var(--ink-3)" }} />
                <span className="mono" style={{ position: "absolute", right: 5, bottom: `calc(${(1 / maxRatio) * 100}% + 2px)`, fontSize: 8.5, color: "var(--ink-3)" }}>capacity</span>
              </div>
              <div className="col" style={{ gap: 0 }}><span className="num small"><b>{w.load.toFixed(1)}h</b> <span className="faint">/ {w.capacity.toFixed(0)}h</span>{Math.abs(delta) > 0.05 && <span className={delta < 0 ? "good" : "bad"}> {delta > 0 ? "+" : ""}{delta.toFixed(1)}</span>}</span><span style={{ fontSize: 10.5, color }}>{label}</span></div>
              <div className="col" style={{ gap: 4 }}>
                {w.items.map((d) => (
                  <div key={d.id} {...drag.handle(d, d.title)} className="chip tint" title={`${d.title} · ${d.kind} · ${fmtDate(d.due_at)} · ~${effort(d)}h — drag to another week`}
                    style={{ "--c": TONE[d.kind] ?? "var(--hue)", height: "auto", padding: "4px 8px", borderRadius: 8, justifyContent: "flex-start", cursor: "grab", outline: moves[d.id] ? "1px dashed var(--ink)" : "none", opacity: drag.dragging?.id === d.id ? 0.4 : 1, touchAction: "none", whiteSpace: "normal" } as any}>
                    <span className="clamp2" style={{ fontSize: 10.5, lineHeight: 1.3 }}>{d.title}<span className="faint"> · {DAYS[(parseLocal(d.due_at).getDay() + 6) % 7].slice(0, 3)}</span></span>
                  </div>
                ))}
              </div>
            </div>); })}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 32 }}>
        <div className="col gap3">
          <div className="row between"><span className="label">Free study blocks · week of {fmtDate(sel.start)}</span><span className="small faint">{sel.classHours.toFixed(1)}h of classes · click a block to plan a session</span></div>
          <div className="plate" style={{ padding: 8 }}>
            {selDays.map((d) => { const blocks = freeBlocks(d, slots, sessions, r); const mine = sessions.filter((s: any) => s.date === ymd(d)); return (
              <div key={ymd(d)} className="row" style={{ padding: "7px 8px", alignItems: "flex-start", gap: 12 }}>
                <span className="small dim" style={{ width: 62, paddingTop: 3 }}>{fmtDate(d, "day")}</span>
                <div className="row wrap gap1 grow">
                  {blocks.map((b) => <button key={b.start} className="chip" onClick={() => setPlan({ date: ymd(d), start: hm(b.start), end: hm(Math.min(b.end, b.start + 120)), max: b.end, deadline_id: "" })}>{hm(b.start)}–{hm(b.end)} <span className="faint">{((b.end - b.start) / 60).toFixed(1)}h</span></button>)}
                  {mine.map((s: any) => <span key={s.id} className="chip tint">Study {hm(s.start_min)}–{hm(s.end_min)}{s.deadline ? ` · ${s.deadline}` : s.course ? ` · ${s.course}` : ""}<button onClick={() => run("DELETE FROM study_sessions WHERE id = ?", [s.id])} aria-label="Remove session"><Icon name="x" size={10} /></button></span>)}
                  {!blocks.length && !mine.length && <span className="small faint">No open block of an hour or more.</span>}
                </div>
              </div>); })}
          </div>
        </div>
        <div className="col gap4">
          <div className="col gap1"><span className="label">Clusters & collisions</span>
            {clusters.length === 0 ? <span className="small faint">No exam clusters or same-day submissions in view.</span> : clusters.map((c, i) => (
              <div key={i} className="plate" style={{ padding: "10px 12px", borderColor: `color-mix(in srgb, ${c.kind === "exams" ? "var(--bad)" : "var(--warn)"} 40%, transparent)` }}>
                <div className="small"><b>{c.kind === "exams" ? `${c.items.length} exams/quizzes within 72 hours` : `${c.items.length} submissions on the same day`}</b> · {fmtDate(c.from)}{c.to !== c.from ? ` – ${fmtDate(c.to)}` : ""}</div>
                <div className="small faint">{c.items.map((d) => d.title).join(" · ")}</div>
              </div>))}
          </div>
          <div className="col gap1 small faint"><span className="label">How this is calculated</span>
            <span>• Without your own estimate, effort defaults by type: {Object.entries(DEFAULT_HOURS).filter(([, h]) => h).map(([k, h]) => `${k} ${h}h`).join(", ")}.</span>
            <span>• Effort is spread evenly over the days before the due date ({Object.entries(LEAD_DAYS).slice(0, 4).map(([k, d]) => `${k} ${d}d`).join(", ")}…), never into the past.</span>
            <span>• Capacity is your study budget of {r.studyPerDay}h a day, limited to the hours between {hm(r.dayStart)} and {hm(r.dayEnd)} left after classes.</span>
            <button className="hue" style={{ textAlign: "left" }} onClick={() => useUI.getState().set({ settings: true })}>Change these rules in Settings →</button>
          </div>
        </div>
      </div>
      {drag.ghost}
      {plan && <Modal title="Plan a study session" sub={fmtDate(plan.date, "long")} onClose={() => setPlan(null)} foot={<><button className="btn ghost" onClick={() => setPlan(null)}>Cancel</button><button className="btn primary" onClick={() => attempt(async () => {
        const s = parseHm(plan.start), e = parseHm(plan.end);
        if (e <= s) throw new Error("The session must end after it starts.");
        const d = real.find((x) => String(x.id) === String(plan.deadline_id));
        await run("INSERT INTO study_sessions(course_id, deadline_id, date, start_min, end_min) VALUES(?,?,?,?,?)", [d?.course_id ?? null, d?.id ?? null, plan.date, s, e]);
        setPlan(null);
      })}>Add session</button></>}>
        <div className="grid2"><Field label="From"><input className="input" type="time" value={plan.start} onChange={(e) => setPlan({ ...plan, start: e.target.value })} /></Field><Field label="Until"><input className="input" type="time" value={plan.end} onChange={(e) => setPlan({ ...plan, end: e.target.value })} /></Field></div>
        <Field label="Working towards"><select className="select" value={plan.deadline_id} onChange={(e) => setPlan({ ...plan, deadline_id: e.target.value })}><option value="">General study</option>{real.map((d) => <option key={d.id} value={d.id}>{d.title} — {fmtDate(d.due_at)}</option>)}</select></Field>
      </Modal>}
    </div>
  );
}
