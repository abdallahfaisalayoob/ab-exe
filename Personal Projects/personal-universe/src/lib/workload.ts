// Academic workload model. Everything here is a stated rule, not a prediction:
//  • an item without an estimate gets a default effort by kind (DEFAULT_HOURS);
//  • its effort is spread evenly over the days leading up to it (LEAD_DAYS), never into the past;
//  • a day's study capacity is the smaller of the user's daily study budget and the hours
//    left between dayStart and dayEnd once classes are subtracted.
import { addDays, dow, parseLocal, weekStart, ymd } from "./dates";

export interface Deadline { id: number; title: string; kind: string; due_at: string; est_hours: number; done: number; course_id: number | null; priority?: number }
export interface Slot { day: number; start_min: number; end_min: number }
export interface Session { date: string; start_min: number; end_min: number }
export interface Rules { dayStart: number; dayEnd: number; studyPerDay: number }
export const DEFAULT_RULES: Rules = { dayStart: 8 * 60, dayEnd: 22 * 60, studyPerDay: 4 };
export const DEFAULT_HOURS: Record<string, number> = { exam: 10, quiz: 2, assignment: 4, lab: 3, presentation: 5, milestone: 6, reminder: 0, event: 0 };
export const LEAD_DAYS: Record<string, number> = { exam: 10, quiz: 3, assignment: 5, lab: 3, presentation: 6, milestone: 7, reminder: 1, event: 1 };

export const effort = (d: Deadline) => (d.est_hours > 0 ? d.est_hours : DEFAULT_HOURS[d.kind] ?? 3);

/** Hours of preparation attributed to each calendar day. */
export function spreadEffort(deadlines: Deadline[], now = new Date()): Map<string, number> {
  const out = new Map<string, number>();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  for (const d of deadlines) {
    const h = effort(d);
    if (d.done || h <= 0) continue;
    const due = parseLocal(d.due_at.slice(0, 10));
    if (due < today) continue;
    let from = addDays(due, -(LEAD_DAYS[d.kind] ?? 5) + 1);
    if (from < today) from = today;
    const days = Math.round((due.getTime() - from.getTime()) / 86400000) + 1;
    for (let i = 0; i < days; i++) { const k = ymd(addDays(from, i)); out.set(k, (out.get(k) ?? 0) + h / days); }
  }
  return out;
}

export function classMinutes(slots: Slot[], day: number) {
  return slots.filter((s) => s.day === day).reduce((n, s) => n + (s.end_min - s.start_min), 0);
}
export function dayCapacity(slots: Slot[], day: number, rules: Rules) {
  const free = Math.max(0, rules.dayEnd - rules.dayStart - classMinutes(slots, day)) / 60;
  return Math.min(rules.studyPerDay, free);
}

export interface WeekLoad { start: string; load: number; capacity: number; classHours: number; ratio: number; level: "light" | "steady" | "heavy" | "over"; items: Deadline[] }
export function weekLoads(deadlines: Deadline[], slots: Slot[], rules: Rules, from: Date, weeks: number, now = new Date()): WeekLoad[] {
  const spread = spreadEffort(deadlines, now);
  const out: WeekLoad[] = [];
  const first = weekStart(from);
  for (let w = 0; w < weeks; w++) {
    const start = addDays(first, w * 7);
    let load = 0, capacity = 0, classHours = 0;
    for (let i = 0; i < 7; i++) {
      load += spread.get(ymd(addDays(start, i))) ?? 0;
      capacity += dayCapacity(slots, i, rules);
      classHours += classMinutes(slots, i) / 60;
    }
    const end = ymd(addDays(start, 6));
    const items = deadlines.filter((d) => d.due_at.slice(0, 10) >= ymd(start) && d.due_at.slice(0, 10) <= end).sort((a, b) => a.due_at.localeCompare(b.due_at));
    const ratio = capacity > 0 ? load / capacity : load > 0 ? 2 : 0;
    out.push({ start: ymd(start), load, capacity, classHours, ratio, items, level: ratio > 1 ? "over" : ratio > 0.75 ? "heavy" : ratio > 0.35 ? "steady" : "light" });
  }
  return out;
}

export interface Cluster { kind: "exams" | "same-day"; from: string; to: string; items: Deadline[] }
/** Exam clusters: two or more exams/quizzes within 72 hours. Same-day: two or more submissions on one date. */
export function findClusters(deadlines: Deadline[]): Cluster[] {
  const open = deadlines.filter((d) => !d.done).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const out: Cluster[] = [];
  const exams = open.filter((d) => d.kind === "exam" || d.kind === "quiz");
  let i = 0;
  while (i < exams.length) {
    let j = i;
    while (j + 1 < exams.length && parseLocal(exams[j + 1].due_at).getTime() - parseLocal(exams[j].due_at).getTime() <= 72 * 3600 * 1000) j++;
    if (j > i) out.push({ kind: "exams", from: exams[i].due_at.slice(0, 10), to: exams[j].due_at.slice(0, 10), items: exams.slice(i, j + 1) });
    i = j + 1;
  }
  const byDay = new Map<string, Deadline[]>();
  for (const d of open) if (d.kind !== "reminder" && d.kind !== "event") byDay.set(d.due_at.slice(0, 10), [...(byDay.get(d.due_at.slice(0, 10)) ?? []), d]);
  for (const [day, items] of byDay) if (items.length > 1 && !out.some((c) => c.kind === "exams" && c.items.length === items.length && c.items.every((x) => items.includes(x)))) out.push({ kind: "same-day", from: day, to: day, items });
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

export interface Block { start: number; end: number }
/** Open stretches of at least `min` minutes in a day, after classes and booked sessions. */
export function freeBlocks(date: Date, slots: Slot[], sessions: Session[], rules: Rules, min = 60): Block[] {
  const day = dow(date), key = ymd(date);
  const busy = [...slots.filter((s) => s.day === day).map((s) => [s.start_min, s.end_min]), ...sessions.filter((s) => s.date === key).map((s) => [s.start_min, s.end_min])].sort((a, b) => a[0] - b[0]);
  const out: Block[] = [];
  let cursor = rules.dayStart;
  for (const [s, e] of busy) {
    if (s - cursor >= min) out.push({ start: cursor, end: Math.min(s, rules.dayEnd) });
    cursor = Math.max(cursor, e);
  }
  if (rules.dayEnd - cursor >= min) out.push({ start: cursor, end: rules.dayEnd });
  return out.filter((b) => b.end - b.start >= min);
}
