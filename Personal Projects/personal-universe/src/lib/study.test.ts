import { describe, expect, it } from "vitest";
import { layout, rhythmOf, spans, suggest, summarise } from "./study";

const r = rhythmOf;
const seg = (minutes: number, course_id = 1, note = "") => ({ course_id, minutes, note });
const show = (bs: ReturnType<typeof layout>) => bs.map((b) => `${b.type === "busy" ? "u" : b.type[0]}${b.seg}:${b.start}-${b.end}`).join(" ");

describe("study plan layout", () => {
  it("runs one subject straight through when there are no breaks", () => {
    expect(show(layout([seg(90)], 600, r("none")))).toBe("w0:600-690");
  });
  it("inserts breaks on the 50/10 rhythm and a short reset between subjects", () => {
    // 14:00 start · 90 min ML, then 60 min DB
    const b = layout([seg(90, 1), seg(60, 2)], 840, r("50-10"));
    expect(show(b)).toBe("w0:840-890 b0:890-900 w0:900-940 b0:940-945 w1:945-995 b1:995-1005 w1:1005-1015");
    const s = summarise(b)!;
    expect(s).toMatchObject({ start: 840, end: 1015, work: 150, breaks: 3, breakMin: 25 });
  });
  it("uses Pomodoro long breaks after every fourth", () => {
    const b = layout([seg(125)], 0, r("25-5"));
    const breaks = b.filter((x) => x.type === "break").map((x) => x.end - x.start);
    expect(breaks).toEqual([5, 5, 5, 15]);
    expect(summarise(b)!.work).toBe(125);
  });
  it("steps around a class and counts the class as the break", () => {
    // Start 13:30, a class 14:00–15:20, 60 min of study.
    const b = layout([seg(60)], 810, r("50-10"), [{ start: 840, end: 920, label: "Operating Systems" }]);
    expect(show(b)).toBe("w0:810-840 u0:840-920 w0:920-950");
    expect(b[1].label).toBe("Operating Systems");
  });
  it("never starts inside a class that is already running", () => {
    const b = layout([seg(30)], 850, r("50-10"), [{ start: 840, end: 920, label: "OS" }]);
    expect(show(b)).toBe("u0:850-920 w0:920-950");
  });
  it("cuts a break short when a class begins", () => {
    const b = layout([seg(50), seg(30, 2)], 780, r("50-10"), [{ start: 833, end: 900, label: "Lab" }]);
    expect(show(b)).toBe("w0:780-830 b0:830-833 u1:833-900 w1:900-930");
  });
  it("gives every subject exactly the minutes asked for and reports its span", () => {
    const segs = [seg(45, 1), seg(0, 3), seg(70, 2)];
    const b = layout(segs, 600, r("50-10"));
    expect(b.filter((x) => x.type === "work" && x.seg === 0).reduce((n, x) => n + x.end - x.start, 0)).toBe(45);
    expect(b.filter((x) => x.type === "work" && x.seg === 2).reduce((n, x) => n + x.end - x.start, 0)).toBe(70);
    expect(spans(segs, b)).toEqual([{ start: 600, end: 645 }, null, { start: 650, end: 730 }]);
  });
  it("flags plans that run past midnight", () => {
    expect(summarise(layout([seg(120)], 23 * 60, r("none")))!.overnight).toBe(true);
  });
});

describe("study suggestions", () => {
  const now = new Date("2026-11-11T09:00:00");
  const dl = (id: number, kind: string, due_at: string, course_id: number, title: string, est_hours = 0) => ({ id, kind, due_at, course_id, title, est_hours, done: 0 });
  it("fills the time from the nearest deadlines, weighted by effort and urgency", () => {
    const s = suggest([dl(1, "quiz", "2026-11-13T15:00", 1, "ML quiz"), dl(2, "exam", "2026-11-18T09:00", 2, "OS midterm"), dl(3, "assignment", "2026-11-30T23:59", 3, "Report"), dl(4, "assignment", "2026-12-20T23:59", 4, "Later")], 180, now);
    expect(s).toHaveLength(3);
    expect(s.reduce((n, x) => n + x.minutes, 0)).toBe(180);
    expect(s[0]).toMatchObject({ course_id: 1, note: "Prepare for ML quiz", deadline_id: 1 });
    expect(s[1].note).toBe("Revise for OS midterm");
    expect(s.every((x) => x.minutes % 15 === 0 && x.minutes >= 15)).toBe(true);
  });
  it("suggests nothing rather than inventing work", () => {
    expect(suggest([], 120, now)).toEqual([]);
    expect(suggest([dl(1, "quiz", "2026-11-01T09:00", 1, "Past quiz")], 120, now)).toEqual([]);
  });
});
