// Spreadsheet → timetable, entirely local and rule-based.
// Handles three common shapes:
//   list  : one class per row, with headed columns (Course, Day, Time, Room…)
//   grid  : times across the top; rows are days — or rooms, with the day in the sheet name / a banner row
//   tgrid : days across the top; rows are times
// Every result is shown to the user for correction before anything is saved.

export interface Sheet { name: string; rows: string[][] }
export interface ParsedSlot { course: string; code: string; section: string; instructor: string; room: string; kind: string; day: number; start: number; end: number; source: string }
export interface ParsedCourse { key: string; name: string; code: string; section: string; instructor: string; slots: ParsedSlot[] }
export interface ParseResult { format: "list" | "grid" | "mixed" | "none"; slots: ParsedSlot[]; courses: ParsedCourse[]; warnings: string[] }

const DAY_RE = /^(mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)(day|sday|nesday|rsday|urday)?$/i;
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export function dayOf(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!t || t.length > 9) return null;
  const m = t.match(DAY_RE);
  return m ? DAY_KEYS.indexOf(m[1].slice(0, 3)) : null;
}
function daysIn(text: string): number[] {
  const out: number[] = [];
  for (const part of text.split(/[\s,/&+]+|(?:\band\b)/i)) {
    const d = part ? dayOf(part) : null;
    if (d != null && !out.includes(d)) out.push(d);
  }
  return out;
}

function toMin(h: number, m: number, ap?: string) {
  if (ap) { h = h % 12; if (ap.toLowerCase().startsWith("p")) h += 12; }
  return h * 60 + m;
}
const T = String.raw`(\d{1,2})(?:[:.]?(\d{2}))?\s*([ap]\.?m\.?)?`;
const RANGE_RE = new RegExp(String.raw`^\D{0,3}${T}\s*(?:-|–|—|to|till)\s*${T}\D{0,3}$`, "i");
const SINGLE_RE = new RegExp(String.raw`^${T}$`, "i");

/** "08:30-09:50", "8:30 AM – 9:50 AM", "0830-0950", "2:00-3:20" (afternoon inferred). */
export function parseTime(text: string): { start: number; end: number | null } | null {
  const t = text.trim().replace(/\s+/g, " ");
  if (!t || t.length > 26) return null;
  const r = t.match(RANGE_RE);
  if (r) {
    if (!r[2] && !r[5] && !r[3] && !r[6] && (+r[1] > 24 || +r[4] > 24)) return null;
    let s = toMin(+r[1], +(r[2] ?? 0), r[3] ?? (r[6] && +r[1] <= +r[4] ? r[6] : undefined));
    let e = toMin(+r[4], +(r[5] ?? 0), r[6]);
    if (+r[1] > 23 || +r[4] > 23) return null;
    if (!r[3] && !r[6]) {
      // No am/pm: universities do not teach at 2 a.m. Anything before 07:00 is an afternoon hour.
      if (s < 7 * 60) s += 720;
      if (e <= s) e += 720;
    } else if (e <= s) e += 720;
    return e - s >= 20 && e - s <= 600 && +(r[2] ?? 0) < 60 && +(r[5] ?? 0) < 60 ? { start: s, end: e } : null;
  }
  const one = t.match(SINGLE_RE);
  if (one && (one[2] || one[3]) && +one[1] <= 23) {
    let s = toMin(+one[1], +(one[2] ?? 0), one[3]);
    if (!one[3] && s < 7 * 60) s += 720;
    return { start: s, end: null };
  }
  return null;
}

const CODE_RE = /\b([A-Z]{2,4})[- ]?(\d{3,4}[A-Z]?)\b/;
const TITLE_RE = /^(dr|mr|ms|mrs|miss|prof|engr|sir|madam|ma'am)\b\.?/i;
const ROOM_RE = /\b((?:room|rm|lab|hall|lt|cr)[\s\-:#]*[A-Z]?\d+[A-Z]?|[A-Z]{1,2}[- ]\d{2,3}[A-Z]?)\b/i;

/** Reads one timetable cell: "Machine Learning (BCS-6A)\nDr. Khan". */
export function parseCell(text: string, hasRoomAxis = false) {
  const lines = text.split(/\r?\n|\s{3,}/).map((l) => l.trim()).filter(Boolean);
  let instructor = "", room = "", section = "", code = "";
  const nameParts: string[] = [];
  lines.forEach((line, i) => {
    if (TITLE_RE.test(line)) { instructor ||= line; return; }
    if (i > 0 && !hasRoomAxis && ROOM_RE.test(line) && line.length < 22) { room ||= line; return; }
    if (i > 0 && nameParts.length && !instructor && /^[A-Z][a-z]+(\s[A-Z][a-z]+){1,3}$/.test(line) && hasRoomAxis) { instructor = line; return; }
    nameParts.push(line);
  });
  let name = nameParts.join(" ");
  const sec = name.match(/[\(\[]([^)\]]{1,24})[\)\]]/);
  if (sec) { section = sec[1].trim(); name = name.replace(sec[0], " "); }
  const c = name.match(CODE_RE);
  if (c) { code = c[1] + c[2]; name = name.replace(c[0], " "); }
  if (!room) { const r = name.match(/\b(?:room|rm)[\s\-:#]*\w+/i); if (r) { room = r[0]; name = name.replace(r[0], " "); } }
  name = name.replace(/\s[-–|:,]\s*$/g, "").replace(/^[\s\-–|:,]+|[\s\-–|:,]+$/g, "").replace(/\s+/g, " ").trim();
  const kind = /\blab\b/i.test(text) ? "Lab" : /\btut(orial)?\b/i.test(text) ? "Tutorial" : "Lecture";
  return { name: name || code, code, section, instructor, room, kind };
}

const HEADERS: Record<string, RegExp> = {
  course: /^(course|subject|title|course ?(name|title)|subject ?name|module|class)$/i,
  code: /^(code|course ?code|subject ?code|course ?id)$/i,
  day: /^(days?|weekday)$/i,
  time: /^(time|timing|timings|slot|time ?slot|period|hours?)$/i,
  start: /^(start|from|start ?time|begin|starts)$/i,
  end: /^(end|to|end ?time|finish|ends|till)$/i,
  room: /^(room|venue|location|place|class ?room|hall|room ?no\.?)$/i,
  instructor: /^(instructor|teacher|faculty|lecturer|professor|teacher ?name|instructor ?name|taught ?by)$/i,
  section: /^(section|sec|group|batch)$/i,
  kind: /^(type|kind|activity|component)$/i,
};

function parseList(sheet: Sheet): ParsedSlot[] | null {
  for (let r = 0; r < Math.min(sheet.rows.length, 20); r++) {
    const cols: Record<string, number> = {};
    sheet.rows[r].forEach((cell, c) => {
      for (const [k, re] of Object.entries(HEADERS)) if (!(k in cols) && re.test(cell.trim())) cols[k] = c;
    });
    if (!("day" in cols) || !("time" in cols || "start" in cols) || !("course" in cols || "code" in cols)) continue;
    const out: ParsedSlot[] = [];
    let lastCourse = "";
    for (let i = r + 1; i < sheet.rows.length; i++) {
      const row = sheet.rows[i];
      const get = (k: string) => (k in cols ? (row[cols[k]] ?? "").trim() : "");
      const days = daysIn(get("day"));
      let time = parseTime(get("time"));
      if (!time && get("start")) {
        const s = parseTime(get("start")), e = parseTime(get("end"));
        if (s) time = { start: s.start, end: e ? (e.start <= s.start ? e.start + 720 : e.start) : null };
      }
      const course = get("course") || get("code") || lastCourse;
      if (!days.length || !time || !course) continue;
      lastCourse = course;
      const cell = parseCell(get("course") || course);
      for (const day of days)
        out.push({ course: cell.name || course, code: get("code").replace(/\s+/g, "") || cell.code, section: get("section") || cell.section, instructor: get("instructor") || cell.instructor,
          room: get("room") || cell.room, kind: get("kind") || cell.kind, day, start: time.start, end: time.end ?? time.start + 60, source: `${sheet.name} · row ${i + 1}` });
    }
    return out;
  }
  return null;
}

function parseGrid(sheet: Sheet): ParsedSlot[] {
  const rows = sheet.rows;
  const out: ParsedSlot[] = [];
  const sheetDay = dayOf(sheet.name.split(/[\s_\-,(]/)[0] ?? "");

  // Find the header row: the first row with at least two time cells or at least three day names.
  let header = -1, mode: "times" | "days" | null = null;
  for (let r = 0; r < Math.min(rows.length, 25) && header < 0; r++) {
    const times = rows[r].filter((c) => parseTime(c)).length;
    const days = rows[r].filter((c) => dayOf(c) != null).length;
    if (times >= 2) { header = r; mode = "times"; } else if (days >= 3) { header = r; mode = "days"; }
  }
  if (header < 0 || !mode) return out;
  const head = rows[header];

  if (mode === "times") {
    const cols: { c: number; start: number; end: number | null }[] = [];
    head.forEach((cell, c) => { const t = parseTime(cell); if (t) cols.push({ c, ...t }); });
    cols.forEach((col, i) => { if (col.end == null) col.end = cols[i + 1] ? cols[i + 1].start : col.start + 60; });
    const firstCol = cols[0].c;
    let currentDay: number | null = sheetDay;
    for (let r = header + 1; r < rows.length; r++) {
      const row = rows[r];
      const filled = row.filter((c) => c.trim());
      if (!filled.length) continue;
      // A banner row naming a day switches the day for the rows beneath it.
      const distinct = [...new Set(filled)];
      if (distinct.length === 1 && dayOf(distinct[0]) != null) { currentDay = dayOf(distinct[0]); continue; }
      const labels = row.slice(0, firstCol).map((c) => c.trim()).filter(Boolean);
      let room = "";
      for (const l of labels) { const d = dayOf(l); if (d != null) currentDay = d; else room ||= l; }
      if (currentDay == null) continue;
      for (let i = 0; i < cols.length; i++) {
        const text = (row[cols[i].c] ?? "").trim();
        if (!text || parseTime(text) || dayOf(text) != null || /^(break|lunch|prayer|jumm?a|namaz|-+|x)$/i.test(text)) continue;
        // A class spanning several slots appears as the same text in adjacent columns.
        let j = i;
        while (j + 1 < cols.length && (row[cols[j + 1].c] ?? "").trim() === text && cols[j + 1].start <= (cols[j].end as number) + 30) j++;
        const cell = parseCell(text, !!room);
        out.push({ course: cell.name, code: cell.code, section: cell.section, instructor: cell.instructor, room: cell.room || room, kind: cell.kind,
          day: currentDay, start: cols[i].start, end: cols[j].end as number, source: `${sheet.name} · row ${r + 1}` });
        i = j;
      }
    }
  } else {
    const dayCols: { c: number; day: number }[] = [];
    head.forEach((cell, c) => { const d = dayOf(cell); if (d != null) dayCols.push({ c, day: d }); });
    const timeRows: { r: number; start: number; end: number | null }[] = [];
    for (let r = header + 1; r < rows.length; r++) {
      const t = rows[r].slice(0, dayCols[0].c).map(parseTime).find(Boolean);
      if (t) timeRows.push({ r, ...t });
    }
    timeRows.forEach((tr, i) => { if (tr.end == null) tr.end = timeRows[i + 1] ? timeRows[i + 1].start : tr.start + 60; });
    for (const { c, day } of dayCols) {
      for (let i = 0; i < timeRows.length; i++) {
        const text = (rows[timeRows[i].r][c] ?? "").trim();
        if (!text || /^(break|lunch|prayer|-+|x)$/i.test(text)) continue;
        let j = i;
        while (j + 1 < timeRows.length && (rows[timeRows[j + 1].r][c] ?? "").trim() === text) j++;
        const cell = parseCell(text);
        out.push({ course: cell.name, code: cell.code, section: cell.section, instructor: cell.instructor, room: cell.room, kind: cell.kind,
          day, start: timeRows[i].start, end: timeRows[j].end as number, source: `${sheet.name} · row ${timeRows[i].r + 1}` });
        i = j;
      }
    }
  }
  return out;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function parseTimetable(sheets: Sheet[]): ParseResult {
  const slots: ParsedSlot[] = [];
  const warnings: string[] = [];
  const formats = new Set<string>();
  for (const sheet of sheets) {
    if (!sheet.rows.length) continue;
    const list = parseList(sheet);
    if (list && list.length) { slots.push(...list); formats.add("list"); continue; }
    const grid = parseGrid(sheet);
    if (grid.length) { slots.push(...grid); formats.add("grid"); } else warnings.push(`Nothing recognisable in sheet “${sheet.name}”.`);
  }
  // De-duplicate identical rows (merged cells and repeated sheets produce them).
  const seen = new Set<string>();
  const unique = slots.filter((s) => { const k = [norm(s.course), s.section, s.day, s.start, s.end, s.room].join("|"); if (seen.has(k)) return false; seen.add(k); return true; });
  const byKey = new Map<string, ParsedCourse>();
  for (const s of unique) {
    const key = (s.code || norm(s.course)) + (s.section ? "|" + norm(s.section) : "");
    let c = byKey.get(key);
    if (!c) { c = { key, name: s.course, code: s.code, section: s.section, instructor: s.instructor, slots: [] }; byKey.set(key, c); }
    if (!c.instructor && s.instructor) c.instructor = s.instructor;
    c.slots.push(s);
  }
  const courses = [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (!unique.length) warnings.push("No classes could be recognised. You can still add courses and class times by hand.");
  return { format: formats.size > 1 ? "mixed" : ((formats.values().next().value as any) ?? "none"), slots: unique, courses, warnings };
}

export interface Clash<T> { a: T; b: T; day: number; start: number; end: number }
/** Two classes clash when they share a day and their times overlap. Touching ends do not clash. */
export function findConflicts<T extends { day: number; start_min?: number; end_min?: number; start?: number; end?: number }>(slots: T[]): Clash<T>[] {
  const s = (x: T) => (x.start_min ?? x.start) as number, e = (x: T) => (x.end_min ?? x.end) as number;
  const out: Clash<T>[] = [];
  const sorted = [...slots].sort((a, b) => a.day - b.day || s(a) - s(b));
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length && sorted[j].day === sorted[i].day && s(sorted[j]) < e(sorted[i]); j++)
      out.push({ a: sorted[i], b: sorted[j], day: sorted[i].day, start: s(sorted[j]), end: Math.min(e(sorted[i]), e(sorted[j])) });
  return out;
}
