import { describe, expect, it } from "vitest";
import { findConflicts, parseCell, parseTime, parseTimetable } from "./timetable";

describe("parseTime", () => {
  it("reads common range notations", () => {
    expect(parseTime("08:30-09:50")).toEqual({ start: 510, end: 590 });
    expect(parseTime("8:30 AM – 9:50 AM")).toEqual({ start: 510, end: 590 });
    expect(parseTime("0830-0950")).toEqual({ start: 510, end: 590 });
    expect(parseTime("11:30 to 1:00")).toEqual({ start: 690, end: 780 });
    expect(parseTime("2:00-3:20")).toEqual({ start: 840, end: 920 });
    expect(parseTime("1:00 PM - 2:20 PM")).toEqual({ start: 780, end: 860 });
    expect(parseTime("10-11")).toEqual({ start: 600, end: 660 });
  });
  it("reads single times and rejects non-times", () => {
    expect(parseTime("09:00")).toEqual({ start: 540, end: null });
    expect(parseTime("C-301")).toBeNull();
    expect(parseTime("Machine Learning")).toBeNull();
    expect(parseTime("2024-2025")).toBeNull();
  });
});

describe("parseCell", () => {
  it("separates name, section, code and instructor", () => {
    expect(parseCell("Machine Learning (BEE-6A)\nDr. Sara Khan", true)).toMatchObject({ name: "Machine Learning", section: "BEE-6A", instructor: "Dr. Sara Khan", kind: "Lecture" });
    expect(parseCell("EE3001 Feedback Control Systems Lab\nRoom 12")).toMatchObject({ code: "EE3001", name: "Feedback Control Systems Lab", kind: "Lab", room: "Room 12" });
  });
});

describe("parseTimetable", () => {
  it("parses a list-style sheet with multi-day rows", () => {
    const r = parseTimetable([{ name: "Sheet1", rows: [
      ["My Timetable — Spring", "", "", "", ""],
      ["Course Code", "Course", "Day", "Time", "Room", "Instructor"],
      ["CS-3005", "Database Systems", "Mon / Wed", "10:00-11:20", "B-12", "Dr. Ali"],
      ["EE3001", "Feedback Control", "Tuesday", "2:00-3:20", "C-301", "Dr. Noor"],
    ] }]);
    expect(r.format).toBe("list");
    expect(r.slots).toHaveLength(3);
    expect(r.courses).toHaveLength(2);
    expect(r.slots[0]).toMatchObject({ code: "CS-3005", day: 0, start: 600, end: 680, room: "B-12", instructor: "Dr. Ali" });
    expect(r.slots[2]).toMatchObject({ day: 1, start: 840, end: 920 });
  });

  it("parses a day × time grid and merges double periods", () => {
    const r = parseTimetable([{ name: "Timetable", rows: [
      ["", "08:30-09:50", "10:00-11:20", "11:30-12:50"],
      ["Monday", "Signals & Systems\nA-101", "", "Machine Learning"],
      ["Tuesday", "Electronics Lab", "Electronics Lab", ""],
    ] }]);
    expect(r.format).toBe("grid");
    expect(r.slots).toHaveLength(3);
    const lab = r.slots.find((s) => s.course === "Electronics Lab")!;
    expect(lab).toMatchObject({ day: 1, start: 510, end: 680, kind: "Lab" });
    expect(r.slots.find((s) => s.course === "Signals & Systems")!.room).toBe("A-101");
  });

  it("parses a room × time grid with one sheet per day (university-wide timetable)", () => {
    const head = ["Room", "08:30-09:50", "10:00-11:20"];
    const r = parseTimetable([
      { name: "Monday", rows: [head, ["C-301", "Machine Learning (BEE-6A)\nDr. Khan", "Operating Systems (BEE-6A)\nMr. Raza"], ["C-302", "", "Machine Learning (BEE-6B)\nDr. Khan"]] },
      { name: "Wednesday", rows: [head, ["C-301", "Machine Learning (BEE-6A)\nDr. Khan", ""]] },
    ]);
    expect(r.slots).toHaveLength(4);
    const a = r.courses.find((c) => c.name === "Machine Learning" && c.section === "BEE-6A")!;
    expect(a.slots.map((s) => s.day)).toEqual([0, 2]);
    expect(a.slots[0]).toMatchObject({ room: "C-301", instructor: "Dr. Khan" });
    expect(r.courses).toHaveLength(3);
  });

  it("parses days across the top with times down the side", () => {
    const r = parseTimetable([{ name: "S", rows: [
      ["Time", "Mon", "Tue", "Wed"],
      ["09:00", "Calculus", "", "Calculus"],
      ["10:00", "Calculus", "Physics", ""],
      ["11:00", "", "Physics", ""],
    ] }]);
    expect(r.slots).toHaveLength(3);
    expect(r.slots.find((s) => s.course === "Calculus" && s.day === 0)).toMatchObject({ start: 540, end: 660 });
    expect(r.slots.find((s) => s.course === "Physics")).toMatchObject({ day: 1, start: 600, end: 720 });
  });

  it("reports sheets it cannot read instead of inventing classes", () => {
    const r = parseTimetable([{ name: "Notes", rows: [["hello", "world"]] }]);
    expect(r.slots).toHaveLength(0);
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("findConflicts", () => {
  it("flags overlaps on the same day only", () => {
    const slots = [
      { id: 1, day: 0, start_min: 600, end_min: 680 },
      { id: 2, day: 0, start_min: 660, end_min: 740 },
      { id: 3, day: 0, start_min: 740, end_min: 800 },
      { id: 4, day: 1, start_min: 600, end_min: 680 },
    ];
    const c = findConflicts(slots);
    expect(c).toHaveLength(1);
    expect([c[0].a.id, c[0].b.id]).toEqual([1, 2]);
    expect(c[0]).toMatchObject({ start: 660, end: 680 });
  });
});
