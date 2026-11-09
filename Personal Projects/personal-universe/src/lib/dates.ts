// All user-facing dates are local wall-clock strings: 'YYYY-MM-DD' or 'YYYY-MM-DDTHH:MM'.
export const pad = (n: number) => String(n).padStart(2, "0");
export const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const ymdhm = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const today = () => ymd(new Date());
export function parseLocal(s: string): Date {
  const [date, time] = s.split("T");
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = (time ?? "00:00").split(":").map(Number);
  return new Date(y, m - 1, d, hh || 0, mm || 0);
}
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());
export const dow = (d: Date) => (d.getDay() + 6) % 7; // 0 = Monday
export const weekStart = (d: Date) => addDays(new Date(d.getFullYear(), d.getMonth(), d.getDate()), -dow(d));
export const monthKey = (d: Date | string) => (typeof d === "string" ? d.slice(0, 7) : ymd(d).slice(0, 7));
export const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
export const hm = (min: number) => `${pad(Math.floor(min / 60))}:${pad(min % 60)}`;
export const parseHm = (s: string) => { const [h, m] = s.split(":").map(Number); return (h || 0) * 60 + (m || 0); };
export const hours = (min: number) => { const h = min / 60; return (Number.isInteger(h) ? h : h.toFixed(1)) + "h"; };

export function daysUntil(iso: string, now = new Date()) {
  const a = parseLocal(iso.slice(0, 10)), b = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}
export function relDay(iso: string, now = new Date()) {
  const n = daysUntil(iso, now);
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  if (n > 1 && n < 14) return `in ${n} days`;
  if (n >= 14 && n < 60) return `in ${Math.round(n / 7)} weeks`;
  if (n >= 60) return `in ${Math.round(n / 30)} months`;
  if (n > -14) return `${-n} days ago`;
  if (n > -60) return `${Math.round(-n / 7)} weeks ago`;
  return `${Math.round(-n / 30)} months ago`;
}
export function fmtDate(d: Date | string, style: "short" | "long" | "day" | "month" = "short") {
  const x = typeof d === "string" ? parseLocal(d) : d;
  const wd = DAYS[dow(x)].slice(0, 3), mo = MONTHS[x.getMonth()];
  if (style === "day") return `${wd} ${x.getDate()}`;
  if (style === "month") return `${mo} ${x.getFullYear()}`;
  if (style === "long") return `${DAYS[dow(x)]}, ${x.getDate()} ${mo} ${x.getFullYear()}`;
  return `${wd} ${x.getDate()} ${mo.slice(0, 3)}`;
}
export const fmtTime = (iso: string) => iso.slice(11, 16);
export function ago(ms: number, now = Date.now()) {
  const s = Math.max(0, (now - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return fmtDate(new Date(ms));
}

const WD = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const MO = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Pulls a date/time out of free text ("ML quiz friday 3pm", "report 12 nov", "in 3 days").
 * Purely rule-based. Returns the remaining text so it can become a title.
 */
export function parseWhen(input: string, now = new Date()): { when: string | null; rest: string; hasTime: boolean } {
  let rest = " " + input + " ";
  let date: Date | null = null;
  let time: [number, number] | null = null;
  const take = (re: RegExp, fn: (m: RegExpMatchArray) => boolean | void) => {
    const m = rest.match(re);
    if (m && fn(m) !== false) rest = rest.replace(m[0], " ");
  };
  const base = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  take(/\s(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\s/i, (m) => {
    let h = +m[1] % 12;
    if (m[3].toLowerCase() === "pm") h += 12;
    time = [h, +(m[2] ?? 0)];
  });
  if (!time) take(/\s(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\s/, (m) => { time = [+m[1], +m[2]]; });
  if (!time) take(/\s(noon|midnight)\s/i, (m) => { time = m[1].toLowerCase() === "noon" ? [12, 0] : [23, 59]; });

  take(/\s(\d{4})-(\d{2})-(\d{2})\s/, (m) => { date = new Date(+m[1], +m[2] - 1, +m[3]); });
  if (!date) take(/\s(today|tonight|tomorrow|tmrw|day after tomorrow)\s/i, (m) => {
    const w = m[1].toLowerCase();
    date = addDays(base, w.startsWith("day after") ? 2 : w.startsWith("tom") || w === "tmrw" ? 1 : 0);
    if (w === "tonight" && !time) time = [21, 0];
  });
  if (!date) take(/\sin\s+(\d+|a|an|two|three)\s+(day|week|month)s?\s/i, (m) => {
    const n = ({ a: 1, an: 1, two: 2, three: 3 } as any)[m[1].toLowerCase()] ?? +m[1];
    const unit = m[2].toLowerCase();
    date = unit === "month" ? new Date(base.getFullYear(), base.getMonth() + n, base.getDate()) : addDays(base, n * (unit === "week" ? 7 : 1));
  });
  if (!date) take(/\s(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?(?:\s+(\d{4}))?\s/i, (m) => { date = mkDate(+m[1], MO.indexOf(m[2].toLowerCase()), m[3] ? +m[3] : null, base); });
  if (!date) take(/\s(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\s/i, (m) => { date = mkDate(+m[2], MO.indexOf(m[1].toLowerCase()), m[3] ? +m[3] : null, base); });
  if (!date) take(/\s(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\s/, (m) => {
    if (+m[2] > 12 || +m[1] > 31) return false;
    date = mkDate(+m[1], +m[2] - 1, m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : null, base);
  });
  if (!date) take(/\s(?:(next|this|on|by)\s+)?(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(?:day|sday|nesday|urday)?\s/i, (m) => {
    const target = WD.indexOf(m[2].toLowerCase().slice(0, 3));
    let diff = (target - dow(base) + 7) % 7;
    if ((m[1] ?? "").toLowerCase() === "next") diff += diff === 0 ? 7 : dow(base) + diff >= 7 ? 0 : 7;
    date = addDays(base, diff);
  });
  if (!date) take(/\snext week\s/i, () => { date = addDays(weekStart(base), 7); });
  if (!date) take(/\s(?:end of|this) week\s/i, () => { date = addDays(weekStart(base), 4); });
  if (!date) take(/\send of (?:the )?month\s/i, () => { date = new Date(base.getFullYear(), base.getMonth() + 1, 0); });

  if (!date && time) date = base;
  rest = rest.replace(/\s(due|on|by|at|for|before|this)\s*$/i, " ").replace(/\s+/g, " ").trim();
  if (!date) return { when: null, rest, hasTime: false };
  const d = date as Date;
  const t = (time as [number, number] | null) ?? [23, 59];
  return { when: `${ymd(d)}T${pad(t[0])}:${pad(t[1])}`, rest, hasTime: !!time };
}
function mkDate(day: number, month: number, year: number | null, base: Date) {
  let d = new Date(year ?? base.getFullYear(), month, day);
  if (year == null && d.getTime() < base.getTime() - 86400000 * 30) d = new Date(base.getFullYear() + 1, month, day);
  return d;
}
