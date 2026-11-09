// Cross-world actions: imports, background job tracking, reminders, captures.
import { create } from "zustand";
import { call, log, native, q, run } from "./backend";
import { setting, useSettings } from "./hooks";
import { toast, useUI } from "./store";
import { plural } from "./format";
import { parseLocal } from "./dates";

export interface Job { id: number; label: string; state: string; total: number; done: number; added: number; updated: number; unchanged: number; missing: number; skipped: number; current: string; error: string | null; collection_id: number; finished_at: number | null }
export const useJobs = create<{ jobs: Job[] }>(() => ({ jobs: [] }));

let polling = false;
let primed = false;
const announced = new Set<number>();
export async function watchJobs() {
  if (polling) return;
  polling = true;
  try {
    for (;;) {
      const jobs = await call<Job[]>("jobs.status");
      useJobs.setState({ jobs });
      // Jobs that had already finished before this window loaded are not announced again.
      if (!primed) { primed = true; jobs.filter((j) => j.finished_at).forEach((j) => announced.add(j.id)); }
      for (const j of jobs) {
        if (j.finished_at && !announced.has(j.id)) {
          announced.add(j.id);
          useUI.getState().bump();
          if (j.state === "error") toast(`${j.label}: ${j.error}`, "error");
          else {
            const parts = [j.added && `${j.added} new`, j.updated && `${j.updated} updated`, j.unchanged && `${j.unchanged} unchanged`, j.missing && `${j.missing} missing`, j.skipped && `${j.skipped} already in your library`].filter(Boolean);
            toast(`${j.label} — ${parts.join(" · ") || "nothing to index"}`, "good");
          }
        }
      }
      if (!jobs.some((j) => !j.finished_at)) break;
      await new Promise((r) => setTimeout(r, 450));
    }
  } catch { /* the next import restarts polling */ }
  polling = false;
}

export async function importPaths(paths: string[], opts: { inbox?: boolean; watched?: boolean } = {}) {
  if (!paths.length) return;
  try {
    const r = await call<{ jobs: number[]; notices: string[] }>("files.import", { paths, ...opts });
    r.notices.forEach((n) => toast(n));
    if (r.jobs.length) void watchJobs();
    useUI.getState().bump();
  } catch (e: any) {
    toast(String(e?.message ?? e), "error");
  }
}
export async function pickAndImport(kind: "folder" | "files", opts: { inbox?: boolean; watched?: boolean } = {}) {
  const paths = await native.pick(kind);
  await importPaths(paths, opts);
}
export async function rescan(collection?: number) {
  await call("files.rescan", collection ? { collection } : {});
  void watchJobs();
}

export async function capture(text: string, source = "typed") {
  const t = text.trim();
  if (!t) return;
  const now = Date.now();
  const r = await run("INSERT INTO notes(owner_type, title, body, state, created_at, updated_at) VALUES('capture', ?, ?, 'open', ?, ?)", [source, t, now, now]);
  void log("tools", "capture", "Captured a note", { type: "note", id: r.lastId }, t.slice(0, 80));
  toast("Captured to your inbox.", "good", { label: "Open", run: () => useUI.getState().go("tools", { tab: "capture" }) });
}
export async function captureClipboard() {
  try {
    const text = await native.paste();
    if (!text.trim()) return toast("The clipboard has no text right now.");
    await capture(text, "clipboard");
  } catch {
    toast("The clipboard could not be read.", "error");
  }
}

export async function openFile(f: { id: number; path: string; name: string }) {
  try {
    await native.openPath(f.path);
    await run("UPDATE files SET opened_at = ? WHERE id = ?", [Date.now(), f.id]);
  } catch (e: any) {
    const { exists } = await call<{ exists: boolean }>("files.check", { path: f.path });
    useUI.getState().bump();
    toast(exists ? String(e?.message ?? e) : `“${f.name}” is no longer at its original location. It stays in your index, marked as missing.`, "error");
  }
}

/** Universal links: connect any two things. */
export async function link(aType: string, aId: number, bType: string, bId: number, label?: string) {
  await run("INSERT OR IGNORE INTO links(a_type, a_id, b_type, b_id, label, created_at) VALUES(?,?,?,?,?,?)", [aType, aId, bType, bId, label ?? null, Date.now()]);
}
export async function unlink(aType: string, aId: number, bType: string, bId: number) {
  await run("DELETE FROM links WHERE (a_type=? AND a_id=? AND b_type=? AND b_id=?) OR (a_type=? AND a_id=? AND b_type=? AND b_id=?)", [aType, aId, bType, bId, bType, bId, aType, aId]);
}

// Reminders: checked once a minute while the app is open. Each stage fires once.
export async function checkReminders() {
  if (!setting("notifications", true)) return;
  const now = Date.now();
  const rows = await q<{ id: number; title: string; due_at: string; kind: string }>("SELECT id, title, due_at, kind FROM deadlines WHERE done = 0 AND due_at >= ? ORDER BY due_at LIMIT 40", [new Date(now - 3600_000).toISOString().slice(0, 10)]);
  const sent: Record<string, number> = { ...setting<Record<string, number>>("notified", {}) };
  let changed = false;
  for (const d of rows) {
    const left = parseLocal(d.due_at).getTime() - now;
    const stage = left <= 0 ? null : left <= 3600_000 ? "1h" : left <= 24 * 3600_000 ? "24h" : null;
    if (!stage) continue;
    const key = `${d.id}:${stage}:${d.due_at}`;
    if (sent[key]) continue;
    sent[key] = now;
    changed = true;
    const body = stage === "1h" ? `Due within the hour (${d.due_at.slice(11)}).` : `Due ${left < 12 * 3600_000 ? "today" : "within 24 hours"} at ${d.due_at.slice(11)}.`;
    const ok = await native.notify(d.title, body);
    if (!ok) toast(`${d.title} — ${body}`);
    void log("academy", "reminder", `Reminder: ${d.title}`, { type: "deadline", id: d.id }, body);
  }
  if (changed) {
    for (const k of Object.keys(sent)) if (now - sent[k] > 14 * 86400_000) delete sent[k];
    await useSettings.getState().put("notified", sent);
  }
}

const GUESS: [RegExp, string][] = [[/lunch|dinner|breakfast|food|cafe|coffee|chai|pizza|burger|biryani|restaurant|snack/i, "Food"], [/uber|careem|indrive|bus|fuel|petrol|metro|taxi|fare|ride/i, "Transport"], [/grocer|mart|store/i, "Groceries"], [/fee|tuition|semester/i, "Tuition"], [/book|notes|print|photocopy|stationery/i, "Books & supplies"], [/rent|hostel/i, "Rent"], [/netflix|spotify|youtube|subscription|icloud/i, "Subscriptions"], [/jazz|zong|telenor|ufone|internet|wifi|package|load/i, "Mobile & internet"], [/medicine|doctor|pharmacy|clinic/i, "Health"], [/salary|pay/i, "Salary"], [/stipend|scholarship/i, "Stipend"], [/freelance|client|fiverr|upwork/i, "Freelance"]];
export const guessCategory = (text: string) => GUESS.find(([re]) => re.test(text))?.[1] ?? "Uncategorised";
