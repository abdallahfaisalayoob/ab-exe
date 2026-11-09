import { describe, expect, it } from "vitest";
import { parseWhen, relDay } from "./dates";
import { advance, balances, byCategory, convert, mapStatement, monthlyFlow, netWorth, netWorthSeries, normDate, project, type Account, type Tx } from "./finance";
import { findClusters, freeBlocks, spreadEffort, weekLoads, DEFAULT_RULES, type Deadline } from "./workload";
import { ftsQuery, fuzzy, money } from "./format";
import { interpret } from "./commands";

const NOW = new Date(2026, 10, 9, 10, 0); // Monday 9 November 2026

describe("parseWhen", () => {
  it("understands relative and absolute dates", () => {
    expect(parseWhen("ML quiz friday 3pm", NOW)).toEqual({ when: "2026-11-13T15:00", rest: "ML quiz", hasTime: true });
    expect(parseWhen("database assignment due tomorrow", NOW)).toMatchObject({ when: "2026-11-10T23:59", rest: "database assignment" });
    expect(parseWhen("report 12 nov at 14:30", NOW)).toMatchObject({ when: "2026-11-12T14:30", rest: "report" });
    expect(parseWhen("in 3 days lab submission", NOW)).toMatchObject({ when: "2026-11-12T23:59", rest: "lab submission" });
    expect(parseWhen("exam 2026-12-01", NOW).when).toBe("2026-12-01T23:59");
    expect(parseWhen("presentation next monday", NOW).when).toBe("2026-11-16T23:59");
    expect(parseWhen("viva 5/12", NOW).when).toBe("2026-12-05T23:59");
    expect(parseWhen("fees jan 5", NOW).when).toBe("2027-01-05T23:59");
    expect(parseWhen("just a title", NOW)).toEqual({ when: null, rest: "just a title", hasTime: false });
  });
  it("describes distance in days", () => {
    expect(relDay("2026-11-09", NOW)).toBe("today");
    expect(relDay("2026-11-12T09:00", NOW)).toBe("in 3 days");
    expect(relDay("2026-11-07", NOW)).toBe("2 days ago");
  });
});

const acc = (id: number, kind: Account["kind"], currency: string, opening: number): Account => ({ id, name: "A" + id, kind, currency, opening_balance: opening, opened_on: "2026-08-01", archived: 0 });
const tx = (id: number, account_id: number, date: string, amount: number, category = "Food", transfer_id: number | null = null): Tx => ({ id, account_id, date, amount, category, payee: "", note: "", transfer_id });

describe("finance", () => {
  const accounts = [acc(1, "bank", "PKR", 100000), acc(2, "cash", "USD", 100), acc(3, "liability", "PKR", -30000)];
  const txs = [
    tx(1, 1, "2026-09-05", 50000, "Stipend"), tx(2, 1, "2026-09-10", -20000, "Food"), tx(3, 1, "2026-09-12", -5000, "Transport"),
    tx(4, 1, "2026-10-05", 50000, "Stipend"), tx(5, 1, "2026-10-11", -30000, "Food"),
    tx(6, 1, "2026-10-15", -28000, "Transfer", 1), tx(7, 2, "2026-10-15", 100, "Transfer", 1),
    tx(8, 1, "2026-11-02", -4000, "Food"),
  ];
  it("converts with the user's rate and keeps balances per account", () => {
    expect(convert(100, "USD", "PKR", 280)).toBe(28000);
    expect(convert(28000, "PKR", "USD", 280)).toBe(100);
    const b = balances(accounts, txs);
    expect(b.get(1)).toBe(100000 + 50000 - 20000 - 5000 + 50000 - 30000 - 28000 - 4000);
    expect(b.get(2)).toBe(200);
  });
  it("computes net worth with liabilities", () => {
    const n = netWorth(accounts, txs, "PKR", 280);
    expect(n.assets).toBe(113000 + 56000);
    expect(n.liabilities).toBe(30000);
    expect(n.net).toBe(139000);
    expect(n.liquid).toBe(169000);
  });
  it("excludes transfers from income and spending", () => {
    const f = monthlyFlow(accounts, txs, "PKR", 280, ["2026-09", "2026-10", "2026-11"]);
    expect(f[0]).toEqual({ month: "2026-09", income: 50000, expense: 25000 });
    expect(f[1]).toEqual({ month: "2026-10", income: 50000, expense: 30000 });
    expect(byCategory(accounts, txs, "PKR", 280, "2026-09")).toEqual([{ category: "Food", total: 20000 }, { category: "Transport", total: 5000 }]);
  });
  it("builds a month-end net-worth series", () => {
    const s = netWorthSeries(accounts, txs, "PKR", 280, ["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(s.map((p) => p.value)).toEqual([0, 98000, 123000, 143000]);
  });
  it("projects only from complete months and says when it cannot", () => {
    const p = project(accounts, txs, "PKR", 280, 3, NOW);
    expect(p.ok).toBe(true);
    expect(p.basisMonths).toEqual(["2026-09", "2026-10"]);
    expect(p.avgNet).toBe(22500);
    expect(p.points[3].value).toBe(139000 + 3 * 22500);
    expect(p.runwayMonths).toBeCloseTo(169000 / 27500);
    expect(project(accounts, [], "PKR", 280, 3, NOW).ok).toBe(false);
  });
  it("advances recurring dates safely across short months", () => {
    expect(advance("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(advance("2026-11-09", "weekly")).toBe("2026-11-16");
    expect(advance("2026-02-28", "yearly")).toBe("2027-02-28");
  });
  it("maps bank statements with debit/credit or signed amounts", () => {
    const r = mapStatement([["Bank export"], ["Date", "Description", "Debit", "Credit"], ["03/11/2026", "Cafe", "1,500.00", ""], ["04-Nov-2026", "Salary", "", "80,000"], ["", "", "", ""], ["bad", "x", "1", ""]]);
    expect(r.ok && r.rows).toEqual([{ date: "2026-11-03", amount: -1500, payee: "Cafe", category: "Uncategorised" }, { date: "2026-11-04", amount: 80000, payee: "Salary", category: "Uncategorised" }]);
    expect(r.ok && r.skipped).toBe(1);
    expect(normDate("2026/1/5")).toBe("2026-01-05");
    expect(mapStatement([["a", "b"]]).ok).toBe(false);
  });
  it("formats money", () => {
    expect(money(-1234.5, "PKR")).toBe("−Rs 1,235");
    expect(money(1234.5, "USD")).toBe("$1,234.50");
    expect(money(2500000, "PKR", { compact: true })).toBe("Rs 2.50M");
  });
});

const dl = (id: number, kind: string, due: string, est = 0): Deadline => ({ id, title: kind + id, kind, due_at: due, est_hours: est, done: 0, course_id: null });

describe("workload", () => {
  it("spreads effort over the lead window without reaching into the past", () => {
    const s = spreadEffort([dl(1, "assignment", "2026-11-13T23:59", 10)], NOW);
    expect([...s.keys()]).toEqual(["2026-11-09", "2026-11-10", "2026-11-11", "2026-11-12", "2026-11-13"]);
    expect(s.get("2026-11-11")).toBe(2);
    const late = spreadEffort([dl(2, "exam", "2026-11-10T09:00")], NOW);
    expect(late.get("2026-11-09")).toBe(5);
    expect(late.get("2026-11-10")).toBe(5);
    expect(spreadEffort([{ ...dl(3, "exam", "2026-11-10T09:00"), done: 1 }], NOW).size).toBe(0);
  });
  it("rates weeks against capacity", () => {
    const slots = [{ day: 0, start_min: 480, end_min: 1200 }]; // Monday is almost entirely classes
    const w = weekLoads([dl(1, "exam", "2026-11-15T09:00", 30)], slots, DEFAULT_RULES, NOW, 2, NOW);
    expect(w[0].start).toBe("2026-11-09");
    expect(w[0].capacity).toBe(2 + 6 * 4);
    expect(w[0].load).toBeCloseTo(30);
    expect(w[0].level).toBe("over");
    expect(w[1].level).toBe("light");
    expect(w[0].items).toHaveLength(1);
  });
  it("finds exam clusters and same-day collisions", () => {
    const c = findClusters([dl(1, "exam", "2026-12-01T09:00"), dl(2, "quiz", "2026-12-03T09:00"), dl(3, "exam", "2026-12-10T09:00"), dl(4, "assignment", "2026-12-20T23:59"), dl(5, "lab", "2026-12-20T17:00")]);
    expect(c).toHaveLength(2);
    expect(c[0]).toMatchObject({ kind: "exams", from: "2026-12-01", to: "2026-12-03" });
    expect(c[1]).toMatchObject({ kind: "same-day", from: "2026-12-20" });
  });
  it("lists free study blocks around classes and booked sessions", () => {
    const blocks = freeBlocks(NOW, [{ day: 0, start_min: 600, end_min: 680 }, { day: 0, start_min: 720, end_min: 800 }], [{ date: "2026-11-09", start_min: 900, end_min: 1020 }], DEFAULT_RULES);
    expect(blocks).toEqual([{ start: 480, end: 600 }, { start: 800, end: 900 }, { start: 1020, end: 1320 }]);
  });
});

describe("search helpers", () => {
  it("builds safe FTS queries", () => {
    expect(ftsQuery("database normalisation")).toBe('"database" "normalisation"*');
    expect(ftsQuery('  "; DROP -- ')).toBe('"drop"*');
    expect(ftsQuery("  ")).toBeNull();
  });
  it("scores fuzzy matches", () => {
    expect(fuzzy("ml", "Machine Learning")).toBeGreaterThan(0);
    expect(fuzzy("mach", "Machine Learning")).toBeGreaterThan(fuzzy("mach", "Some machine"));
    expect(fuzzy("xyz", "Machine Learning")).toBe(0);
  });
});

describe("command interpretation", () => {
  const first = (t: string) => interpret(t, NOW)[0];
  it("recognises structured commands", () => {
    expect(first("switch to finance world")).toMatchObject({ type: "go", world: "finance" });
    expect(first("add a deadline for my database assignment friday")).toMatchObject({ type: "deadline", kind: "assignment", title: "Database assignment", due: "2026-11-13T23:59" });
    expect(first("quiz ML tomorrow 9am")).toMatchObject({ type: "deadline", kind: "quiz", title: "ML", due: "2026-11-10T09:00" });
    expect(first("spent 450 on lunch")).toMatchObject({ type: "tx", amount: -450, payee: "lunch" });
    expect(first("earned 20000 freelance")).toMatchObject({ type: "tx", amount: 20000 });
    expect(first("create a new project Line Follower Robot")).toMatchObject({ type: "project", name: "Line Follower Robot" });
    expect(first("find all pdfs containing database normalisation")).toMatchObject({ type: "search", ext: "pdf", text: "database normalisation" });
    expect(first("find every document related to machine learning")).toMatchObject({ type: "search", kind: "doc", text: "machine learning" });
    expect(first("show files modified in the last seven days")).toMatchObject({ type: "recent", days: 7 });
    expect(first("show assignments due this week")).toMatchObject({ type: "due", range: "week", kind: "assignment" });
    expect(first("show my spending this month")).toMatchObject({ type: "go", world: "finance" });
    expect(first("open my university timetable")).toMatchObject({ type: "go", world: "academy", tab: "week" });
    expect(first("note buy breadboard jumper wires")).toMatchObject({ type: "capture", text: "buy breadboard jumper wires" });
  });
  it("falls back to opening things by name", () => {
    expect(first("open my machine learning course")).toMatchObject({ type: "open", text: "machine learning", hint: "course" });
    expect(first("open my FYP workspace")).toMatchObject({ type: "open", text: "FYP", hint: "project" });
    expect(interpret("thevenin", NOW)).toEqual([]);
  });
});
