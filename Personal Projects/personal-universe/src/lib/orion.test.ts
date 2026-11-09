import { describe, expect, it } from "vitest";
import { compose, sky, type Facts } from "./orion";

const base: Facts = { address: "sir", classes: [], deadlines: [], doing: [], milestones: [], recurring: [], inbox: 0, captures: 0, files: 120, spent: 0, overBudget: [], currency: "PKR", hasMoney: false, lastBackup: null, weather: null };
const at = (h: number, m = 0) => new Date(2026, 10, 9, h, m); // Monday 9 November 2026

describe("ORION briefing", () => {
  it("greets by time of day and uses the chosen form of address", () => {
    expect(compose(base, at(8)).greeting).toBe("Good morning, sir.");
    expect(compose({ ...base, address: "Abdallah" }, at(15)).greeting).toBe("Good afternoon, Abdallah.");
    expect(compose({ ...base, address: "" }, at(19)).greeting).toBe("Good evening.");
    expect(compose(base, at(2)).greeting).toMatch(/midnight oil/);
  });
  it("describes the next class and warns when it is close", () => {
    const f = { ...base, classes: [{ name: "Machine Learning", start_min: 510, end_min: 590, room: "C-301" }, { name: "Operating Systems", start_min: 600, end_min: 680, room: "" }] };
    const b = compose(f, at(8, 15));
    expect(b.lines[0].text).toBe("2 classes today. First: Machine Learning at 08:30 in C-301 — that is in 15 minutes.");
    expect(b.lines[0].tone).toBe("warn");
    expect(compose(f, at(9)).lines[0].text).toBe("You are in Machine Learning until 09:50, then Operating Systems at 10:00.");
    expect(compose(f, at(18)).lines[0].text).toBe("All 2 classes are done for today.");
  });
  it("chooses the mission by a fixed priority: overdue, today, tomorrow, exam, milestone, in progress", () => {
    const d = (title: string, kind: string, due_at: string, id = 1) => ({ id, title, kind, due_at });
    const all = { ...base, deadlines: [d("Lab report", "lab", "2026-11-07T23:59"), d("DB assignment", "assignment", "2026-11-09T17:00"), d("ML quiz", "quiz", "2026-11-10T09:00"), d("Signals", "exam", "2026-11-14T09:00")], doing: [{ title: "PID tuning", project: "Robot" }] };
    expect(compose(all, at(8)).mission).toMatchObject({ title: "Lab report" });
    expect(compose({ ...all, deadlines: all.deadlines.slice(1) }, at(8)).mission).toMatchObject({ title: "DB assignment", why: "It is due today at 17:00." });
    expect(compose({ ...all, deadlines: all.deadlines.slice(2) }, at(8)).mission!.title).toBe("ML quiz");
    expect(compose({ ...all, deadlines: all.deadlines.slice(3) }, at(8)).mission!.title).toBe("Revise for Signals");
    expect(compose({ ...base, doing: all.doing }, at(8)).mission!.title).toBe("PID tuning");
    expect(compose(base, at(8)).mission).toBeNull();
    const speech = compose(all, at(8)).speech;
    expect(speech).toContain("1 item past due: Lab report.");
    expect(speech).toContain("If you do one thing today, sir: Lab report.");
  });
  it("reports money and weather only when they exist, and never invents them", () => {
    const quiet = compose(base, at(8));
    expect(quiet.lines.some((l) => l.icon === "wallet")).toBe(false);
    expect(quiet.speech).not.toMatch(/degrees/);
    const b = compose({ ...base, hasMoney: true, spent: 21450, overBudget: ["Food"], weather: { place: "Islamabad", temp: 17.6, code: 61, high: 22, low: 11, rain: 70, fetchedAt: 0 } }, at(8));
    expect(b.lines[0].text).toBe("Islamabad: 18° with rain. High 22°, low 11°, 70% chance of rain. An umbrella would be prudent.");
    expect(b.lines.find((l) => l.icon === "wallet")!.text).toBe("Rs 21,450 spent so far in November. Over budget on Food.");
    expect(b.status).toContain("weather via open-meteo.com");
    expect(quiet.status).toContain("nothing sent anywhere");
    expect(sky(95)).toBe("thunderstorms");
  });
});
