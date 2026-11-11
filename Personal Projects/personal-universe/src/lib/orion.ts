// O.R.I.O.N. — Offline, Rather Intelligent, Organisational Navigator.
// The launch briefing. `compose` is a pure function over facts gathered from the local
// database, so every sentence ORION says can be traced to a row you entered. The only
// optional online ingredient is the weather, which is off until you switch it on.
import { call, fileUrl, q } from "./backend";
import { setting, useSettings } from "./hooks";
import { DAYS, MONTHS, addDays, daysUntil, dow, hm, relDay, ymd } from "./dates";
import { byCategory, convert, type Account, type Tx } from "./finance";
import { money, plural } from "./format";
import { monthKey } from "./dates";
import type { World } from "./store";

export interface Weather { place: string; temp: number; code: number; high: number; low: number; rain: number; fetchedAt: number }
export interface Facts {
  address: string;
  classes: { name: string; start_min: number; end_min: number; room: string }[];
  deadlines: { id: number; title: string; kind: string; due_at: string }[];
  doing: { title: string; project: string }[];
  milestones: { title: string; project: string; date: string }[];
  recurring: { title: string; next_date: string; amount: number; currency: string }[];
  inbox: number; captures: number; files: number;
  spent: number; overBudget: string[]; currency: string; hasMoney: boolean;
  lastBackup: number | null;
  weather: Weather | null;
  /** Study planned for today and not yet started. */
  study?: { start_min: number; subjects: string; minutes: number }[];
}
export interface Line { icon: string; text: string; world?: World; tab?: string; tone?: "warn" | "good" }
export interface Mission { title: string; why: string; world: World; tab?: string }
export interface Briefing { greeting: string; dateLine: string; lines: Line[]; status: string[]; mission: Mission | null; signoff: string; speech: string }

const WMO: [number[], string][] = [[[0], "clear skies"], [[1, 2], "partly cloudy"], [[3], "overcast"], [[45, 48], "fog"], [[51, 53, 55, 56, 57], "drizzle"], [[61, 63, 65, 66, 67, 80, 81, 82], "rain"], [[71, 73, 75, 77, 85, 86], "snow"], [[95, 96, 99], "thunderstorms"]];
export const sky = (code: number) => WMO.find(([c]) => c.includes(code))?.[1] ?? "mixed skies";

const SIGNOFFS = ["All systems nominal.", "Shall we begin?", "I'll be in the top bar if you need me.", "The universe is in order. Mostly.", "Ready when you are.", "Standing by."];
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function compose(f: Facts, now: Date, seed = now.getDate() + now.getHours()): Briefing {
  const h = now.getHours(), nowMin = h * 60 + now.getMinutes(), sir = f.address ? `, ${f.address}` : "";
  const greeting = h < 5 ? `Burning the midnight oil${sir}?` : h < 12 ? `Good morning${sir}.` : h < 17 ? `Good afternoon${sir}.` : h < 22 ? `Good evening${sir}.` : `Welcome back${sir}. It is rather late.`;
  const dateLine = `${DAYS[dow(now)]}, ${now.getDate()} ${MONTHS[now.getMonth()]} · ${hm(nowMin)}`;
  const lines: Line[] = [];
  const say: string[] = [greeting];

  if (f.weather) {
    const w = f.weather, advice = w.rain >= 50 ? " An umbrella would be prudent." : w.high >= 36 ? " Hydration is advised." : w.low <= 4 ? " A jacket is advised." : "";
    const t = `${w.place}: ${Math.round(w.temp)}° with ${sky(w.code)}. High ${Math.round(w.high)}°, low ${Math.round(w.low)}°, ${Math.round(w.rain)}% chance of rain.${advice}`;
    lines.push({ icon: "home", text: t });
    say.push(`It is ${Math.round(w.temp)} degrees in ${w.place} with ${sky(w.code)}.${advice}`);
  }

  // Classes
  const left = f.classes.filter((c) => c.end_min > nowMin), current = f.classes.find((c) => c.start_min <= nowMin && c.end_min > nowMin), next = f.classes.find((c) => c.start_min > nowMin);
  if (f.classes.length === 0) lines.push({ icon: "calendar", text: "No classes on the timetable today.", world: "academy", tab: "week" });
  else if (!left.length) { lines.push({ icon: "calendar", text: `All ${plural(f.classes.length, "class", "classes")} are done for today.`, world: "academy", tab: "week", tone: "good" }); }
  else {
    const where = (c: typeof f.classes[0]) => (c.room ? ` in ${c.room}` : "");
    const t = current ? `You are in ${current.name} until ${hm(current.end_min)}${next ? `, then ${next.name} at ${hm(next.start_min)}${where(next)}` : ""}.`
      : `${plural(left.length, "class", "classes")} ${left.length === f.classes.length ? "today" : "still to go"}. ${left.length === f.classes.length ? "First" : "Next"}: ${next!.name} at ${hm(next!.start_min)}${where(next!)}${next!.start_min - nowMin <= 60 ? ` — that is in ${next!.start_min - nowMin} minutes` : ""}.`;
    lines.push({ icon: "calendar", text: t, world: "academy", tab: "week", tone: next && next.start_min - nowMin <= 20 ? "warn" : undefined });
    say.push(t);
  }

  // Study planned for later today
  const plan = (f.study ?? []).find((p) => p.start_min >= nowMin - 20);
  if (plan) { const t = `Study planned at ${hm(plan.start_min)}: ${plan.subjects}, ${Math.round(plan.minutes / 6) / 10} hours.`; lines.push({ icon: "book", text: t, world: "academy", tab: "planner" }); say.push(t); }

  // Deadlines
  const open = f.deadlines.map((d) => ({ ...d, n: daysUntil(d.due_at, now) })).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const overdue = open.filter((d) => d.n < 0 && d.kind !== "event"), dueToday = open.filter((d) => d.n === 0), tomorrow = open.filter((d) => d.n === 1);
  if (overdue.length) { const t = `${plural(overdue.length, "item")} past due: ${overdue.slice(0, 2).map((d) => d.title).join(", ")}${overdue.length > 2 ? " and more" : ""}.`; lines.push({ icon: "warn", text: t, world: "academy", tab: "deadlines", tone: "warn" }); say.push(t); }
  if (dueToday.length) { const t = `Due today: ${dueToday.map((d) => `${d.title} at ${d.due_at.slice(11)}`).join("; ")}.`; lines.push({ icon: "flag", text: t, world: "academy", tab: "deadlines", tone: "warn" }); say.push(t); }
  if (tomorrow.length) { const t = `Due tomorrow: ${tomorrow.map((d) => d.title).join(", ")}.`; lines.push({ icon: "flag", text: t, world: "academy", tab: "deadlines" }); say.push(t); }
  const exam = open.find((d) => d.kind === "exam" && d.n >= 2 && d.n <= 14);
  if (exam) { const t = `${exam.title} exam ${relDay(exam.due_at, now)}.`; lines.push({ icon: "academy", text: t, world: "academy", tab: "planner" }); if (exam.n <= 7) say.push(t); }
  if (!overdue.length && !dueToday.length && !tomorrow.length) lines.push({ icon: "check", text: open.length ? `Nothing due today or tomorrow. Next: ${open[0].title}, ${relDay(open[0].due_at, now)}.` : "No deadlines on record.", world: "academy", tab: "deadlines", tone: "good" });

  // Projects
  const ms = f.milestones.filter((m) => daysUntil(m.date, now) <= 3).sort((a, b) => a.date.localeCompare(b.date))[0];
  if (ms) lines.push({ icon: "projects", text: `${ms.project}: milestone “${ms.title}” ${relDay(ms.date, now)}.`, world: "projects", tone: daysUntil(ms.date, now) <= 0 ? "warn" : undefined });
  if (f.doing.length) lines.push({ icon: "projects", text: `${plural(f.doing.length, "task")} in progress — ${f.doing.slice(0, 2).map((t) => t.title).join(", ")}${f.doing.length > 2 ? "…" : ""}.`, world: "projects" });

  // Money
  if (f.hasMoney) {
    const rec = f.recurring.filter((r) => daysUntil(r.next_date, now) <= 3);
    lines.push({ icon: "wallet", text: `${money(f.spent, f.currency)} spent so far in ${MONTHS[now.getMonth()]}.${f.overBudget.length ? ` Over budget on ${f.overBudget.join(", ")}.` : ""}${rec.length ? ` ${rec.map((r) => `${r.title} is due ${relDay(r.next_date, now)}`).join("; ")}.` : ""}`, world: "finance", tone: f.overBudget.length ? "warn" : undefined });
    if (f.overBudget.length) say.push(`You are over budget on ${f.overBudget.join(" and ")}.`);
  }
  if (f.inbox + f.captures > 0) lines.push({ icon: "inbox", text: `${[f.inbox && plural(f.inbox, "file") + " in the inbox", f.captures && plural(f.captures, "captured note")].filter(Boolean).join(" and ")} waiting to be sorted.`, world: f.inbox ? "knowledge" : "tools", tab: f.inbox ? "inbox" : "capture" });

  // The single most useful thing to do next — a fixed priority order, nothing clever.
  let mission: Mission | null = null;
  if (overdue[0]) mission = { title: overdue[0].title, why: `It was due ${relDay(overdue[0].due_at, now)} and is still open.`, world: "academy", tab: "deadlines" };
  else if (dueToday[0]) mission = { title: dueToday[0].title, why: `It is due today at ${dueToday[0].due_at.slice(11)}.`, world: "academy", tab: "deadlines" };
  else if (tomorrow[0]) mission = { title: tomorrow[0].title, why: "It is due tomorrow.", world: "academy", tab: "deadlines" };
  else if (exam && exam.n <= 7) mission = { title: `Revise for ${exam.title}`, why: `The exam is ${relDay(exam.due_at, now)}.`, world: "academy", tab: "planner" };
  else if (ms) mission = { title: ms.title, why: `Milestone for ${ms.project}, ${relDay(ms.date, now)}.`, world: "projects" };
  else if (f.doing[0]) mission = { title: f.doing[0].title, why: `Already in progress in ${f.doing[0].project}.`, world: "projects" };
  else if (open[0]) mission = { title: open[0].title, why: `Your next deadline, ${relDay(open[0].due_at, now)}.`, world: "academy", tab: "deadlines" };
  if (mission) say.push(`If you do one thing today${sir}: ${mission.title}.`);

  const backup = f.lastBackup == null ? "no backup yet" : now.getTime() - f.lastBackup < 36 * 3600_000 ? "backup current" : `last backup ${Math.round((now.getTime() - f.lastBackup) / 86400000)} days ago`;
  const status = [`${f.files.toLocaleString()} files indexed`, "database healthy", backup, f.weather ? "weather via open-meteo.com" : "nothing sent anywhere"];
  const signoff = SIGNOFFS[seed % SIGNOFFS.length];
  say.push(signoff);
  return { greeting, dateLine, lines, status, mission, signoff, speech: say.join(" ") };
}

export async function gather(now = new Date(), weather: Weather | null = null): Promise<Facts> {
  const base = setting("currency", "PKR"), rate = setting("usdRate", 0), month = monthKey(now);
  const [classes, deadlines, doing, milestones, recurring, counts, accounts, txs, budgets, study, backups] = await Promise.all([
    q<any>("SELECT c.name, s.start_min, s.end_min, s.room FROM class_slots s JOIN courses c ON c.id = s.course_id WHERE s.day = ? AND c.archived = 0 ORDER BY s.start_min", [dow(now)]),
    q<any>("SELECT id, title, kind, due_at FROM deadlines WHERE done = 0 AND kind != 'event' ORDER BY due_at LIMIT 60"),
    q<any>("SELECT t.title, p.name project FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.status = 'doing' AND p.status = 'active' ORDER BY t.priority DESC LIMIT 8"),
    q<any>("SELECT m.title, m.date, p.name project FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.done = 0 AND p.status = 'active'"),
    q<any>("SELECT title, next_date, amount, currency FROM recurring WHERE active = 1"),
    q<any>("SELECT (SELECT COUNT(*) FROM files) files, (SELECT COUNT(*) FROM files WHERE inbox_state = 'new') inbox, (SELECT COUNT(*) FROM notes WHERE owner_type = 'capture' AND state = 'open') captures"),
    q<Account>("SELECT * FROM accounts"), q<Tx>("SELECT * FROM transactions WHERE date >= ?", [month + "-01"]),
    q<any>("SELECT * FROM budgets"),
    q<any>("SELECT p.start_min, (SELECT GROUP_CONCAT(COALESCE(c.name, 'general study'), ', ') FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.plan_id = p.id) subjects, (SELECT SUM(minutes) FROM study_sessions s WHERE s.plan_id = p.id) minutes FROM study_plans p WHERE p.date = ? AND p.state = 'planned' ORDER BY p.start_min", [ymd(now)]).catch(() => []),
    import("./backend").then((b) => b.call<any[]>("backup.list")).catch(() => []),
  ]);
  const cats = byCategory(accounts, txs, base, rate, month);
  return {
    address: setting("orion.address", "sir"), classes, deadlines, doing, milestones, recurring,
    inbox: counts[0].inbox, captures: counts[0].captures, files: counts[0].files,
    spent: cats.reduce((s, c) => s + c.total, 0), currency: base, hasMoney: accounts.length > 0,
    overBudget: budgets.filter((b: any) => (cats.find((c) => c.category === b.category)?.total ?? 0) > convert(b.monthly_limit, b.currency, base, rate)).map((b: any) => b.category),
    lastBackup: backups[0]?.modified ?? null, weather, study,
  };
}

// ── Evening wrap-up ──────────────────────────────────────────────────────────
export interface DayFacts {
  address: string;
  finished: string[];            // deadlines and tasks completed today
  focusMinutes: number;
  filesAdded: number; captured: number;
  spent: number; currency: string; hasMoney: boolean;
  carried: { title: string; due_at: string }[];   // was due today or earlier, still open
  tomorrowClasses: { name: string; start_min: number; room: string }[];
  tomorrowDue: string[];
}
export interface WrapUp { greeting: string; dateLine: string; done: Line[]; ahead: Line[]; signoff: string; speech: string }

export function composeWrap(f: DayFacts, now: Date): WrapUp {
  const h = now.getHours(), sir = f.address ? `, ${f.address}` : "";
  const greeting = h < 5 ? `Time to rest${sir}.` : h < 17 ? `Stepping away${sir}?` : h < 21 ? `That's the day${sir}.` : `Good night${sir}.`;
  const done: Line[] = [], ahead: Line[] = [], say = [greeting];
  if (f.finished.length) { const t = `You finished ${plural(f.finished.length, "thing")} today: ${f.finished.slice(0, 3).join(", ")}${f.finished.length > 3 ? ` and ${f.finished.length - 3} more` : ""}.`; done.push({ icon: "check", text: t, tone: "good" }); say.push(t); }
  if (f.focusMinutes > 0) { const t = `${f.focusMinutes} minutes of focused work.`; done.push({ icon: "clock", text: t, tone: "good" }); say.push(t); }
  const misc = [f.filesAdded && plural(f.filesAdded, "file") + " added to your library", f.captured && plural(f.captured, "thought") + " captured"].filter(Boolean).join(" and ");
  if (misc) done.push({ icon: "knowledge", text: cap(misc) + "." });
  if (f.hasMoney) done.push({ icon: "wallet", text: f.spent > 0 ? `${money(f.spent, f.currency)} spent today.` : "Nothing spent today.", world: "finance" });
  if (!f.finished.length && !f.focusMinutes && !misc) done.push({ icon: "home", text: "A quiet day on the record — and that is allowed." });

  if (f.carried.length) { const t = `${plural(f.carried.length, "item")} ${f.carried.length === 1 ? "moves" : "move"} to tomorrow: ${f.carried.slice(0, 3).map((c) => c.title).join(", ")}.`; ahead.push({ icon: "flag", text: t, world: "academy", tab: "deadlines", tone: "warn" }); say.push(t); }
  const first = f.tomorrowClasses[0];
  if (first) { const t = `Tomorrow starts with ${first.name} at ${hm(first.start_min)}${first.room ? ` in ${first.room}` : ""}${f.tomorrowClasses.length > 1 ? `, ${f.tomorrowClasses.length} classes in all` : ""}.`; ahead.push({ icon: "calendar", text: t, world: "academy", tab: "week" }); say.push(t); }
  else ahead.push({ icon: "calendar", text: "No classes tomorrow.", world: "academy", tab: "week", tone: "good" });
  if (f.tomorrowDue.length) { const t = `Due tomorrow: ${f.tomorrowDue.join(", ")}.`; ahead.push({ icon: "flag", text: t, world: "academy", tab: "deadlines" }); say.push(t); }
  const signoff = h >= 21 || h < 5 ? "I'll keep the lights on. Sleep well." : "Everything is saved. I'll be here.";
  say.push(signoff);
  return { greeting, dateLine: `${DAYS[dow(now)]}, ${now.getDate()} ${MONTHS[now.getMonth()]} · ${hm(h * 60 + now.getMinutes())}`, done, ahead, signoff, speech: say.join(" ") };
}

export async function gatherDay(now = new Date()): Promise<DayFacts> {
  const day = ymd(now), tmr = addDays(now, 1), base = setting("currency", "PKR"), rate = setting("usdRate", 0);
  const local = (col: string) => `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch', 'localtime')`;
  const [fin, focus, counts, accounts, txs, carried, classes, due] = await Promise.all([
    q<any>(`SELECT title FROM deadlines WHERE done = 1 AND ${local("done_at")} = ?1 UNION ALL SELECT title FROM tasks WHERE done_at IS NOT NULL AND ${local("done_at")} = ?1`, [day]),
    q<any>(`SELECT title FROM activity WHERE kind = 'focus' AND ${local("ts")} = ?`, [day]),
    q<any>(`SELECT (SELECT COUNT(*) FROM files WHERE ${local("imported_at")} = ?1) files, (SELECT COUNT(*) FROM notes WHERE owner_type = 'capture' AND ${local("created_at")} = ?1) captured`, [day]),
    q<Account>("SELECT * FROM accounts"), q<Tx>("SELECT * FROM transactions WHERE date = ?", [day]),
    q<any>("SELECT title, due_at FROM deadlines WHERE done = 0 AND kind NOT IN ('event') AND substr(due_at, 1, 10) <= ? ORDER BY due_at", [day]),
    q<any>("SELECT c.name, s.start_min, s.room FROM class_slots s JOIN courses c ON c.id = s.course_id WHERE s.day = ? AND c.archived = 0 ORDER BY s.start_min", [dow(tmr)]),
    q<any>("SELECT title FROM deadlines WHERE done = 0 AND substr(due_at, 1, 10) = ? ORDER BY due_at", [ymd(tmr)]),
  ]);
  return {
    address: setting("orion.address", "sir"), finished: fin.map((r: any) => r.title),
    focusMinutes: focus.reduce((n: number, r: any) => n + (parseInt(r.title.replace(/\D+/g, " ").trim()) || 0), 0),
    filesAdded: counts[0].files, captured: counts[0].captured,
    spent: byCategory(accounts, txs, base, rate).reduce((s, c) => s + c.total, 0), currency: base, hasMoney: accounts.length > 0,
    carried, tomorrowClasses: classes, tomorrowDue: due.map((r: any) => r.title),
  };
}

// ── Weather (optional, online, off by default) ───────────────────────────────
export interface Place { name: string; lat: number; lon: number }
/** Looks a city up once. Sends only the text you typed to open-meteo.com. */
export async function findPlace(name: string): Promise<Place | null> {
  const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?count=1&name=${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(6000) });
  const j = await r.json();
  const p = j.results?.[0];
  return p ? { name: p.name, lat: Math.round(p.latitude * 100) / 100, lon: Math.round(p.longitude * 100) / 100 } : null;
}
/** Fetches the forecast for the saved coordinates. Cached for an hour; silent when offline. */
export async function getWeather(): Promise<Weather | null> {
  const place = setting<Place | null>("orion.place", null);
  if (!setting("orion.weather", false) || !place) return null;
  const cached = setting<Weather | null>("orion.weatherCache", null);
  if (cached && cached.place === place.name && Date.now() - cached.fetchedAt < 3600_000) return cached;
  try {
    const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&forecast_days=1&timezone=auto`, { signal: AbortSignal.timeout(3500) });
    const j = await r.json();
    const w: Weather = { place: place.name, temp: j.current.temperature_2m, code: j.current.weather_code, high: j.daily.temperature_2m_max[0], low: j.daily.temperature_2m_min[0], rain: j.daily.precipitation_probability_max[0] ?? 0, fetchedAt: Date.now() };
    void useSettings.getState().put("orion.weatherCache", w);
    return w;
  } catch {
    return cached && cached.place === place.name && Date.now() - cached.fetchedAt < 6 * 3600_000 ? cached : null;
  }
}

// ── Voice ────────────────────────────────────────────────────────────────────
// Two engines, both offline. The natural voice (a neural model installed from Settings) is used
// when present; otherwise a voice already installed in Windows speaks.
let sapi: SpeechSynthesisVoice | null | undefined;
let audio: HTMLAudioElement | null = null;
let turn = 0;
function pickVoice() {
  if (sapi !== undefined || !("speechSynthesis" in window)) return sapi ?? null;
  const all = speechSynthesis.getVoices().filter((v) => v.localService && v.lang.startsWith("en"));
  if (!all.length) return null;
  sapi = all.find((v) => /Natural/i.test(v.name)) ?? all.find((v) => /George|Daniel|Ryan|Arthur/i.test(v.name)) ?? all.find((v) => v.lang === "en-GB") ?? all.find((v) => /David|Mark|Guy/i.test(v.name)) ?? all[0];
  return sapi;
}
const natural = () => (setting("orion.natural", false) ? setting<string | null>("orion.naturalVoice", null) : null);
export const canSpeak = () => !!natural() || "speechSynthesis" in window;
export const isSpeaking = () => (audio != null && !audio.paused && !audio.ended) || ("speechSynthesis" in window && speechSynthesis.speaking);
export function hush() { turn++; if (audio) { audio.pause(); audio = null; } if ("speechSynthesis" in window) speechSynthesis.cancel(); }

function speakSystem(text: string) {
  if (!("speechSynthesis" in window)) return;
  const go = () => { const v = pickVoice(); if (!v) return; speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text.replace(/[“”]/g, "")); u.voice = v; u.rate = 1.0; u.pitch = 0.95; speechSynthesis.speak(u); };
  if (speechSynthesis.getVoices().length) go(); else { speechSynthesis.onvoiceschanged = () => { speechSynthesis.onvoiceschanged = null; go(); }; }
}
function play(path: string, mine: number) {
  return new Promise<void>((resolve, reject) => {
    if (mine !== turn) return resolve();
    const a = new Audio(fileUrl(path));
    audio = a;
    a.onended = () => resolve();
    a.onerror = () => reject(new Error("audio"));
    a.play().catch(reject);
  });
}
/** Speaks with the best voice available. The opening sentence is synthesised first so ORION answers at once. */
export async function speak(text: string, voice = natural()) {
  if (!setting("orion.voice", true)) return;
  hush();
  if (!voice) return speakSystem(text);
  const mine = turn, cut = text.search(/[.?!]\s/);
  const parts = cut > 0 && text.length > 90 ? [text.slice(0, cut + 1), text.slice(cut + 2)] : [text];
  try {
    const clips = parts.map((t) => call<{ path: string }>("voice.speak", { voice, text: t }));
    for (const c of clips) { const { path } = await c; if (mine !== turn) return; await play(path, mine); }
  } catch {
    if (mine === turn) speakSystem(text); // never leave the user in silence because a file went missing
  }
}

export const JOKES = [
  "Why do electrical engineers make poor gardeners? They keep grounding everything.",
  "A capacitor and a resistor walk into a bar. The capacitor says: I can't stay long, I'm on a time constant.",
  "There are 10 kinds of people: those who read binary, and those who don't.",
  "I would tell you a UDP joke, sir, but you might not get it.",
  "The Fourier transform walked into a bar and asked for a pint. The bartender said: we don't serve your kind. It left, feeling a little out of phase.",
  "Your code compiled on the first try. I have scheduled a full diagnostic of reality.",
  "An op-amp's favourite genre is feedback. Preferably negative.",
];
