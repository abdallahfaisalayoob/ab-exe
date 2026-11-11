// Study plans: one sitting, several subjects, each with its own minutes and intent.
// `layout` turns that into a timeline — work, breaks, and the classes it has to step around.
// Pure and deterministic, so the plan you preview is exactly the plan the timer runs.
import { effort, type Deadline } from "./workload";

export interface Segment { course_id: number | null; minutes: number; note: string; deadline_id?: number | null }
export interface Rhythm { id: string; label: string; hint: string; work: number; brk: number; long?: number; every?: number }
export interface Busy { start: number; end: number; label: string }
export interface Block { type: "work" | "break" | "busy"; seg: number; start: number; end: number; label?: string }

export const RHYTHMS: Rhythm[] = [
  { id: "50-10", label: "50 / 10", hint: "50 minutes on, 10 off — a good default for university work", work: 50, brk: 10 },
  { id: "25-5", label: "Pomodoro", hint: "25 on, 5 off, a 15-minute break after every fourth", work: 25, brk: 5, long: 15, every: 4 },
  { id: "90-15", label: "Deep work", hint: "90 on, 15 off — for long problem sets and projects", work: 90, brk: 15 },
  { id: "none", label: "No breaks", hint: "One straight run; breaks only for classes", work: 0, brk: 0 },
];
export const rhythmOf = (id: string) => RHYTHMS.find((r) => r.id === id) ?? RHYTHMS[0];

/** A short reset when switching subjects, if at least this much work came before it. */
const SWITCH_AFTER = 20;

export function layout(segs: Segment[], start: number, rhythm: Rhythm, busy: Busy[] = []): Block[] {
  const out: Block[] = [];
  const cal = [...busy].filter((b) => b.end > start).sort((a, b) => a.start - b.start);
  let t = start, since = 0, breaks = 0;
  const inside = () => cal.find((b) => b.start <= t && b.end > t);
  const next = () => cal.find((b) => b.start > t);
  const rest = (len: number, seg: number, label?: string) => {
    if (len <= 0) return;
    const nb = next();
    const end = nb ? Math.min(t + len, nb.start) : t + len; // a class can stand in for the end of a break
    if (end > t) out.push({ type: "break", seg, start: t, end, label });
    t = end;
    since = 0;
  };
  const active = segs.filter((s) => s.minutes > 0);
  active.forEach((seg, i) => {
    const si = segs.indexOf(seg);
    let left = seg.minutes;
    while (left > 0) {
      const b = inside();
      if (b) { out.push({ type: "busy", seg: si, start: t, end: b.end, label: b.label }); t = b.end; since = 0; continue; }
      let chunk = left;
      if (rhythm.work > 0) chunk = Math.min(chunk, rhythm.work - since);
      const nb = next();
      if (nb) chunk = Math.min(chunk, nb.start - t);
      const prev = out[out.length - 1];
      if (prev && prev.type === "work" && prev.seg === si && prev.end === t) prev.end += chunk;
      else out.push({ type: "work", seg: si, start: t, end: t + chunk });
      t += chunk; left -= chunk; since += chunk;
      const more = left > 0 || i < active.length - 1;
      if (rhythm.work > 0 && since >= rhythm.work && more && !inside()) {
        breaks++;
        rest(rhythm.long && rhythm.every && breaks % rhythm.every === 0 ? rhythm.long : rhythm.brk, si);
      }
    }
    // Changing subjects: a brief reset, so the next subject starts with a clear head.
    if (i < active.length - 1 && rhythm.brk > 0 && since >= SWITCH_AFTER && !inside()) rest(Math.min(5, rhythm.brk), si, "switch");
  });
  return out;
}

export interface Summary { start: number; end: number; work: number; breaks: number; breakMin: number; busy: Block[]; overnight: boolean }
export function summarise(blocks: Block[]): Summary | null {
  if (!blocks.length) return null;
  const sum = (k: Block["type"]) => blocks.filter((b) => b.type === k).reduce((n, b) => n + b.end - b.start, 0);
  return {
    start: blocks[0].start, end: blocks[blocks.length - 1].end, work: sum("work"), breakMin: sum("break"),
    breaks: blocks.filter((b) => b.type === "break").length, busy: blocks.filter((b) => b.type === "busy"), overnight: blocks[blocks.length - 1].end > 24 * 60,
  };
}

/** Where each subject sits in the day: first minute of work to last. */
export function spans(segs: Segment[], blocks: Block[]) {
  return segs.map((_, i) => {
    const own = blocks.filter((b) => b.type === "work" && b.seg === i);
    return own.length ? { start: own[0].start, end: own[own.length - 1].end } : null;
  });
}

const VERB: Record<string, string> = { exam: "Revise for", quiz: "Prepare for", assignment: "Work on", lab: "Finish", presentation: "Rehearse", milestone: "Push forward" };
const round15 = (n: number) => Math.max(15, Math.round(n / 15) * 15);
/**
 * Fills `total` minutes from your nearest open deadlines, in proportion to how much work
 * each one needs (the same effort rule the workload planner uses). Never invents subjects.
 */
export function suggest(deadlines: (Deadline & { title: string })[], total: number, now = new Date()): Segment[] {
  const today = now.toISOString().slice(0, 10);
  const pool = deadlines.filter((d) => !d.done && d.course_id && d.due_at.slice(0, 10) >= today && !["reminder", "event"].includes(d.kind))
    .sort((a, b) => a.due_at.localeCompare(b.due_at)).slice(0, 3);
  if (!pool.length) return [];
  const weight = pool.map((d) => effort(d) / Math.max(1, (new Date(d.due_at).getTime() - now.getTime()) / 86400000));
  const sum = weight.reduce((a, b) => a + b, 0);
  const mins = weight.map((w) => round15((w / sum) * total));
  mins[0] += total - mins.reduce((a, b) => a + b, 0); // keep the total exact
  return pool.map((d, i) => ({ course_id: d.course_id, minutes: Math.max(15, mins[i]), note: `${VERB[d.kind] ?? "Work on"} ${d.title}`, deadline_id: d.id })).filter((s) => s.minutes > 0);
}

export const fmtMin = (m: number) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}`);
