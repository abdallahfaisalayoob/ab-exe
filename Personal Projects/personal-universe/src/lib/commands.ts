// The Universal Action Engine's grammar. Local, deterministic pattern rules — no model.
// `interpret` turns a sentence into zero or more structured intents; the palette combines
// them with fuzzy entity matches and full-text search.
import { parseWhen } from "./dates";
import type { World } from "./store";

export type Interp =
  | { type: "go"; world: World; tab?: string; label: string }
  | { type: "deadline"; kind: string; title: string; due: string | null }
  | { type: "tx"; amount: number; payee: string; category: string }
  | { type: "project"; name: string }
  | { type: "task"; title: string; project: string }
  | { type: "capture"; text: string }
  | { type: "search"; text: string; kind?: string; ext?: string }
  | { type: "recent"; days: number }
  | { type: "due"; range: "today" | "week" | "month"; kind?: string }
  | { type: "open"; text: string; hint?: "course" | "project" | "file" };

const WORLD_WORDS: Record<string, World> = { home: "home", knowledge: "knowledge", files: "knowledge", library: "knowledge", academy: "academy", university: "academy", finance: "finance", money: "finance", finances: "finance", projects: "projects", archive: "archive", "time machine": "archive", tools: "tools", toolbox: "tools" };
const KINDS: Record<string, string> = { assignment: "assignment", homework: "assignment", quiz: "quiz", exam: "exam", midterm: "exam", final: "exam", presentation: "presentation", lab: "lab", milestone: "milestone", reminder: "reminder", event: "event", deadline: "assignment" };
const FILE_WORDS: Record<string, { kind?: string; ext?: string }> = { pdf: { ext: "pdf" }, pdfs: { ext: "pdf" }, document: { kind: "doc" }, documents: { kind: "doc" }, docs: { kind: "doc" }, image: { kind: "image" }, images: { kind: "image" }, photos: { kind: "image" }, screenshots: { kind: "image" }, slides: { kind: "slides" }, presentations: { kind: "slides" }, spreadsheets: { kind: "sheet" }, sheets: { kind: "sheet" }, code: { kind: "code" }, videos: { kind: "video" }, notes: { kind: "doc" }, files: {}, file: {} };
const NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, ten: 10, fourteen: 14, thirty: 30 };
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const tidy = (s: string) => s.replace(/^(?:(?:a|an|the|my|new|for|to|called|named)\s+)+/i, "").replace(/\s+/g, " ").trim();

export function interpret(input: string, now = new Date()): Interp[] {
  const text = input.trim().replace(/[.?!]+$/, "");
  const low = text.toLowerCase();
  if (low.length < 2) return [];
  const out: Interp[] = [];
  let m: RegExpMatchArray | null;

  // Navigation
  if ((m = low.match(/^(?:go to|switch to|open|show|take me to)\s+(?:the\s+|my\s+)?(.+?)(?:\s+world)?$/)) && WORLD_WORDS[m[1]]) {
    out.push({ type: "go", world: WORLD_WORDS[m[1]], label: cap(WORLD_WORDS[m[1]]) });
    return out;
  }
  if (/\b(timetable|schedule|classes)\b/.test(low) && /^(open|show|view)\b/.test(low)) return [{ type: "go", world: "academy", tab: "week", label: "Timetable" }];
  if (/\b(spending|expenses|budget|net worth|finances?)\b/.test(low) && /^(show|open|view|how much)\b/.test(low)) return [{ type: "go", world: "finance", tab: /budget/.test(low) ? "budgets" : "overview", label: "Finance overview" }];
  if (/\b(workload|semester plan|planner)\b/.test(low) && /^(show|open|view)\b/.test(low)) return [{ type: "go", world: "academy", tab: "planner", label: "Workload planner" }];

  // "show assignments due this week"
  if ((m = low.match(/^(?:show|list|what(?:'s| is| are))?\s*(?:my\s+|all\s+)?(assignments?|quizz?e?s?|exams?|deadlines?|labs?|everything|what)?\s*(?:is |are )?due\s+(today|this week|this month|tomorrow)?/)) && (m[1] || m[2])) {
    const k = m[1]?.replace(/(zes|es|s)$/, "").replace(/^quiz$/, "quiz");
    out.push({ type: "due", range: m[2] === "today" || m[2] === "tomorrow" ? "today" : m[2] === "this month" ? "month" : "week", kind: k && KINDS[k] && k !== "deadline" ? KINDS[k] : undefined });
    return out;
  }

  // Recent files
  if ((m = low.match(/(?:files?|documents?)\s+(?:modified|changed|edited|added|imported)\s+(?:in|within|during)?\s*(?:the\s+)?(?:last|past)\s+(\w+)\s+(day|week|month)s?/))) {
    const n = NUM[m[1]] ?? (parseInt(m[1]) || 1);
    return [{ type: "recent", days: n * (m[2] === "week" ? 7 : m[2] === "month" ? 30 : 1) }];
  }
  if (/^(show\s+)?recent files$/.test(low)) return [{ type: "recent", days: 7 }];

  // Search
  if ((m = text.match(/^(?:find|search|search for|look for|show)\s+(?:me\s+)?(?:all\s+|every\s+|my\s+)*(?:the\s+)?(\w+)?\s*(?:that\s+)?(?:containing|contain|contains|about|related to|on|with|mentioning|for)\s+(.+)$/i))) {
    const fw = m[1] ? FILE_WORDS[m[1].toLowerCase()] : {};
    if (fw) { out.push({ type: "search", text: m[2].trim(), ...fw }); return out; }
  }
  if ((m = text.match(/^(?:find|search|search for|look for)\s+(.+)$/i))) return [{ type: "search", text: m[1].trim() }];

  // Money
  if ((m = text.match(/^(?:i\s+)?(?:spent|paid|bought|expense|add expense)\s+(?:rs\.?\s*|pkr\s*|\$)?([\d,]+(?:\.\d+)?)\s*(?:rs|pkr|rupees)?\s*(?:on|for|at)?\s*(.*)$/i)))
    return [{ type: "tx", amount: -parseFloat(m[1].replace(/,/g, "")), payee: m[2].trim(), category: "" }];
  if ((m = text.match(/^(?:i\s+)?(?:earned|received|got|income|add income)\s+(?:rs\.?\s*|pkr\s*|\$)?([\d,]+(?:\.\d+)?)\s*(?:rs|pkr|rupees)?\s*(?:from|for|as)?\s*(.*)$/i)))
    return [{ type: "tx", amount: parseFloat(m[1].replace(/,/g, "")), payee: m[2].trim(), category: "" }];

  // Projects, tasks, captures
  if ((m = text.match(/^(?:create|new|add|start)\s+(?:a\s+)?(?:new\s+)?project\s*(.*)$/i))) return [{ type: "project", name: tidy(m[1]) }];
  if ((m = text.match(/^(?:add|new|create)\s+(?:a\s+)?task\s+(.+?)(?:\s+(?:in|to|for)\s+(.+))?$/i))) return [{ type: "task", title: cap(m[1].trim()), project: (m[2] ?? "").trim() }];
  if ((m = text.match(/^(?:note|capture|remember|jot)(?:\s+that)?[:\s]+(.+)$/i))) return [{ type: "capture", text: m[1].trim() }];

  // Deadlines: "add a deadline for my database assignment friday", "quiz ML tomorrow 9am"
  const lead = low.match(/^(?:add|create|new|set|schedule)\s+(?:a\s+|an\s+)?(?:new\s+)?(deadline|assignment|homework|quiz|exam|midterm|final|presentation|lab|milestone|reminder|event)\b\s*(.*)$/) ?? low.match(/^(assignment|homework|quiz|exam|midterm|presentation|lab|reminder|remind me)\b[:\s]+(.+)$/);
  if (lead) {
    const body = text.slice(text.length - lead[2].length);
    const { when, rest } = parseWhen(body, now);
    let title = tidy(rest.replace(/^(?:for|to|about|on)\s+/i, ""));
    let kind = KINDS[lead[1]] ?? "reminder";
    if (lead[1] === "deadline") { const inner = title.toLowerCase().match(/\b(assignment|quiz|exam|presentation|lab)\b/); if (inner) kind = KINDS[inner[1]]; }
    out.push({ type: "deadline", kind, title: cap(title) || cap(kind), due: when });
    return out;
  }

  // "open my machine learning course", "open my FYP workspace"
  if ((m = text.match(/^(?:open|show|go to)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(course|class|subject|project|workspace|folder|file))?$/i))) {
    const hint = m[2] ? (/course|class|subject/i.test(m[2]) ? "course" : /project|workspace/i.test(m[2]) ? "project" : "file") : undefined;
    out.push({ type: "open", text: m[1].trim(), hint });
  }
  return out;
}
