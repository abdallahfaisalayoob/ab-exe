// The Personal Insight Engine. Every insight is a plain rule over data the user entered,
// and carries its own explanation (`why`). Nothing is predicted and nothing is invented.
import { q } from "./backend";
import { setting } from "./hooks";
import { daysUntil, fmtDate, monthKey, relDay, today } from "./dates";
import { byCategory, convert, monthsBack, type Account, type Tx } from "./finance";
import { bytes, money, plural } from "./format";
import { DEFAULT_RULES, findClusters, weekLoads, type Deadline, type Slot } from "./workload";
import type { World } from "./store";

export interface Insight { id: string; world: World; tone: "info" | "warn" | "good"; title: string; why: string; tab?: string; rank: number }

export async function computeInsights(now = new Date()): Promise<Insight[]> {
  const out: Insight[] = [];
  const base = setting("currency", "PKR"), rate = setting("usdRate", 0);
  const [deadlines, slots, inbox, dups, missing, accounts, txs, budgets, recurring, milestones, overdueTasks, captures] = await Promise.all([
    q<Deadline & { title: string }>("SELECT * FROM deadlines WHERE done = 0"),
    q<Slot>("SELECT day, start_min, end_min FROM class_slots"),
    q<{ n: number }>("SELECT COUNT(*) n FROM files WHERE inbox_state = 'new'"),
    q<{ groups: number; waste: number }>("SELECT COUNT(*) groups, COALESCE(SUM(waste), 0) waste FROM (SELECT (COUNT(*) - 1) * MAX(size) waste FROM files WHERE hash IS NOT NULL AND missing = 0 GROUP BY hash HAVING COUNT(*) > 1)"),
    q<{ n: number }>("SELECT COUNT(*) n FROM files WHERE missing = 1"),
    q<Account>("SELECT * FROM accounts"),
    q<Tx>("SELECT * FROM transactions WHERE date >= ?", [monthsBack(4, now)[0] + "-01"]),
    q<{ category: string; monthly_limit: number; currency: string }>("SELECT * FROM budgets"),
    q<{ title: string; amount: number; currency: string; next_date: string }>("SELECT * FROM recurring WHERE active = 1"),
    q<{ title: string; date: string; project: string }>("SELECT m.title, m.date, p.name project FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.done = 0 AND p.status = 'active'"),
    q<{ n: number }>("SELECT COUNT(*) n FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.status != 'done' AND t.due_date < ? AND p.status = 'active'", [today()]),
    q<{ n: number }>("SELECT COUNT(*) n FROM notes WHERE owner_type = 'capture' AND state = 'open'"),
  ]);

  // Academy
  const overdue = deadlines.filter((d) => daysUntil(d.due_at, now) < 0 && d.kind !== "event");
  if (overdue.length) out.push({ id: "overdue", world: "academy", tab: "deadlines", tone: "warn", rank: 95, title: `${plural(overdue.length, "item")} past due and still open`, why: `Not marked done and dated before today: ${overdue.slice(0, 3).map((d) => d.title).join(", ")}${overdue.length > 3 ? "…" : ""}.` });
  const soon = deadlines.filter((d) => { const n = daysUntil(d.due_at, now); return n >= 0 && n <= 2; });
  if (soon.length) out.push({ id: "soon", world: "academy", tab: "deadlines", tone: "warn", rank: 90, title: soon.length === 1 ? `${soon[0].title} is due ${relDay(soon[0].due_at, now)}` : `${soon.length} things due within two days`, why: soon.map((d) => `${d.title} (${relDay(d.due_at, now)})`).join(" · ") });
  const rules = { ...DEFAULT_RULES, ...setting("studyRules", {}) };
  const weeks = weekLoads(deadlines, slots, rules, now, 4, now);
  const over = weeks.find((w) => w.level === "over");
  if (over) out.push({ id: "overload", world: "academy", tab: "planner", tone: "warn", rank: 80, title: `The week of ${fmtDate(over.start)} needs more time than it has`, why: `Planned preparation is ${over.load.toFixed(0)}h against ${over.capacity.toFixed(0)}h of study capacity (your ${rules.studyPerDay}h/day budget, minus class time).` });
  const cluster = findClusters(deadlines).find((c) => daysUntil(c.from, now) >= 0 && daysUntil(c.from, now) <= 21);
  if (cluster) out.push({ id: "cluster", world: "academy", tab: "planner", tone: "info", rank: 70, title: cluster.kind === "exams" ? `${cluster.items.length} exams or quizzes fall within three days` : `${cluster.items.length} submissions share ${fmtDate(cluster.from)}`, why: cluster.items.map((d) => d.title).join(" · ") });

  // Knowledge
  if (inbox[0]?.n) out.push({ id: "inbox", world: "knowledge", tab: "inbox", tone: "info", rank: 50, title: `${plural(inbox[0].n, "file")} waiting in your inbox`, why: "Dropped into the universal drop zone and not yet reviewed." });
  if (dups[0]?.groups) out.push({ id: "dups", world: "knowledge", tab: "duplicates", tone: "info", rank: 30, title: `${plural(dups[0].groups, "set")} of identical files`, why: `Files with byte-identical content. Keeping one of each would free about ${bytes(dups[0].waste)}. Nothing is removed unless you do it yourself.` });
  if (missing[0]?.n) out.push({ id: "missing", world: "knowledge", tab: "missing", tone: "warn", rank: 45, title: `${plural(missing[0].n, "indexed file")} can no longer be found`, why: "They were moved, renamed or deleted outside Personal Universe since the last scan." });
  if (captures[0]?.n >= 5) out.push({ id: "captures", world: "tools", tab: "capture", tone: "info", rank: 20, title: `${captures[0].n} captured notes are unsorted`, why: "Captured from the clipboard or command bar and still open." });

  // Finance
  if (accounts.length && txs.length) {
    const months = monthsBack(4, now), cur = months[3], prev = months.slice(0, 3);
    const thisMonth = byCategory(accounts, txs, base, rate, cur);
    for (const c of thisMonth.slice(0, 6)) {
      const past = prev.map((m) => byCategory(accounts, txs, base, rate, m).find((x) => x.category === c.category)?.total ?? 0).filter((v) => v > 0);
      if (past.length < 2) continue;
      const avg = past.reduce((a, b) => a + b, 0) / past.length;
      if (c.total > avg * 1.4 && c.total - avg > 0) { out.push({ id: "spend-" + c.category, world: "finance", tone: "warn", rank: 60, title: `${c.category} spending is ${Math.round((c.total / avg - 1) * 100)}% above your recent average`, why: `${money(c.total, base)} so far this month against an average of ${money(avg, base)} over the previous ${past.length} months.` }); break; }
    }
    for (const b of budgets) {
      const spent = thisMonth.find((c) => c.category === b.category)?.total ?? 0, limit = convert(b.monthly_limit, b.currency, base, rate);
      if (limit > 0 && spent / limit >= 0.85) out.push({ id: "budget-" + b.category, world: "finance", tab: "budgets", tone: spent > limit ? "warn" : "info", rank: spent > limit ? 65 : 40, title: spent > limit ? `${b.category} is over budget` : `${b.category} is at ${Math.round((spent / limit) * 100)}% of its budget`, why: `${money(spent, base)} of ${money(limit, base)} for ${fmtDate(cur + "-01", "month")}.` });
    }
  }
  const dueRec = recurring.filter((r) => daysUntil(r.next_date, now) <= 5);
  if (dueRec.length) out.push({ id: "recurring", world: "finance", tab: "recurring", tone: "info", rank: 55, title: dueRec.length === 1 ? `${dueRec[0].title} is due ${relDay(dueRec[0].next_date, now)}` : `${dueRec.length} recurring payments within five days`, why: dueRec.map((r) => `${r.title} ${money(Math.abs(r.amount), r.currency)} (${relDay(r.next_date, now)})`).join(" · ") });

  // Projects
  const ms = milestones.filter((m) => daysUntil(m.date, now) <= 7).sort((a, b) => a.date.localeCompare(b.date));
  if (ms.length) out.push({ id: "milestones", world: "projects", tone: daysUntil(ms[0].date, now) < 0 ? "warn" : "info", rank: 58, title: `${ms[0].project}: “${ms[0].title}” ${daysUntil(ms[0].date, now) < 0 ? "was due " : "is due "}${relDay(ms[0].date, now)}`, why: ms.length > 1 ? `Plus ${plural(ms.length - 1, "more milestone")} within a week.` : "An open milestone in an active project." });
  if (overdueTasks[0]?.n) out.push({ id: "tasks", world: "projects", tone: "info", rank: 35, title: `${plural(overdueTasks[0].n, "task")} past their date`, why: "Open tasks in active projects with a due date before today." });

  return out.sort((a, b) => b.rank - a.rank);
}
export { monthKey };
