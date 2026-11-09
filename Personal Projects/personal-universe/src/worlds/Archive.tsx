// Archive — the personal time machine, the road ahead, reviews, backups and the privacy
// ledger. Everything here is read from what the app recorded locally about itself.
import { useMemo, useState } from "react";
import { call, isTauri, native, q, run } from "../lib/backend";
import { MONTHS, addDays, ago, fmtDate, monthKey, parseLocal, relDay, today, weekStart, ymd } from "../lib/dates";
import { bytes, money, plural } from "../lib/format";
import { useIntent, useQ, useRows, useSetting } from "../lib/hooks";
import { attempt, useUI, World } from "../lib/store";
import { Icon } from "../ui/Icons";
import { Confirm, Empty, Seg, Tabs } from "../ui/kit";

type Tab = "machine" | "ahead" | "review" | "backups" | "privacy";
const WORLD_OF: Record<string, World> = { knowledge: "knowledge", academy: "academy", finance: "finance", projects: "projects", archive: "archive", tools: "tools", home: "home" };
const localDay = (col: string) => `strftime('%Y-%m-%d', ${col} / 1000, 'unixepoch', 'localtime')`;

/** One unified stream of what happened: logged activity plus events derived from the data itself. */
const EVENTS = `
  SELECT ts, world, kind, title, detail FROM activity
  UNION ALL SELECT d.done_at, 'academy', 'done', 'Completed: ' || d.title, d.kind FROM deadlines d WHERE d.done = 1 AND d.done_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.ref_type = 'deadline' AND a.ref_id = d.id AND a.kind = 'done')
  UNION ALL SELECT t.done_at, 'projects', 'done', 'Finished: ' || t.title, p.name FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.done_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM activity a WHERE a.kind = 'done' AND a.title = 'Finished: ' || t.title)
  UNION ALL SELECT g.done_at, 'home', 'goal', 'Goal reached: ' || g.title, NULL FROM goals g WHERE g.done = 1 AND g.done_at IS NOT NULL`;

export default function Archive() {
  const [tab, setTab] = useState<Tab>("machine");
  useIntent("archive", (i) => { if (i.tab) setTab(i.tab as Tab); });
  return (
    <>
      <div className="world-head"><div><h1 className="display">Archive</h1><p className="sub">How your universe has grown, what is coming, and the safety net underneath it all.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "machine", label: "Time machine" }, { id: "ahead", label: "The road ahead" }, { id: "review", label: "Review" }, { id: "backups", label: "Backup & recovery" }, { id: "privacy", label: "Privacy ledger" }]} />
      <div className="world-body">{tab === "machine" ? <TimeMachine /> : tab === "ahead" ? <Ahead /> : tab === "review" ? <Review /> : tab === "backups" ? <Backups /> : <Privacy />}</div>
    </>
  );
}

function TimeMachine() {
  const go = useUI((s) => s.go);
  const [base] = useSetting("currency", "PKR");
  const months = useRows<any>(`SELECT strftime('%Y-%m', ts / 1000, 'unixepoch', 'localtime') m, world, COUNT(*) n FROM (${EVENTS}) WHERE ts IS NOT NULL GROUP BY m, world ORDER BY m`);
  const fileMonths = useRows<any>("SELECT strftime('%Y-%m', imported_at / 1000, 'unixepoch', 'localtime') m, COUNT(*) n, SUM(size) size FROM files GROUP BY m");
  const keys = useMemo(() => [...new Set([...months.map((m) => m.m), ...fileMonths.map((m) => m.m)])].sort(), [months, fileMonths]);
  const [pick, setPick] = useState<string | null>(null);
  const month = pick && keys.includes(pick) ? pick : keys.at(-1) ?? monthKey(new Date());
  const events = useRows<any>(`SELECT * FROM (${EVENTS}) WHERE ts IS NOT NULL AND strftime('%Y-%m', ts / 1000, 'unixepoch', 'localtime') = ? ORDER BY ts DESC LIMIT 500`, [month]);
  const snap = useQ(async () => (await q<any>(`SELECT
      (SELECT COUNT(*) FROM files WHERE ${localDay("imported_at")} <= ?1) files, (SELECT COALESCE(SUM(size), 0) FROM files WHERE ${localDay("imported_at")} <= ?1) size,
      (SELECT COUNT(*) FROM deadlines WHERE done = 1 AND ${localDay("done_at")} <= ?1) done, (SELECT COUNT(*) FROM tasks WHERE done_at IS NOT NULL AND ${localDay("done_at")} <= ?1) tasks,
      (SELECT COUNT(*) FROM projects WHERE ${localDay("created_at")} <= ?1) projects, (SELECT COUNT(*) FROM courses WHERE ${localDay("created_at")} <= ?1) courses,
      (SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0) FROM transactions WHERE transfer_id IS NULL AND category != 'Valuation' AND substr(date, 1, 7) = ?2) income,
      (SELECT COALESCE(-SUM(CASE WHEN amount < 0 THEN amount END), 0) FROM transactions WHERE transfer_id IS NULL AND category != 'Valuation' AND substr(date, 1, 7) = ?2) spent`, [month + "-31", month]))[0], [month]).data;
  if (!keys.length) return <Empty icon="archive" title="Your history starts now">As you import files, finish work and record money, this becomes a timeline you can scrub through — month by month, world by world. It is recorded only on this computer.</Empty>;
  const totals = keys.map((k) => ({ k, parts: (["knowledge", "academy", "finance", "projects", "tools", "home", "archive"] as const).map((w) => ({ w, n: months.filter((m) => m.m === k && m.world === w).reduce((s, m) => s + m.n, 0) })) }));
  const max = Math.max(1, ...totals.map((t) => t.parts.reduce((s, p) => s + p.n, 0)));
  const days = [...events.reduce((g, e) => { const d = ymd(new Date(e.ts)); g.set(d, [...(g.get(d) ?? []), e]); return g; }, new Map<string, any[]>()).entries()];
  const idx = keys.indexOf(month);
  return (
    <div className="col gap5">
      <div className="plate pad lit">
        <div className="row between"><span className="label">Activity by month · coloured by world</span><div className="row"><button className="icon-btn sm" disabled={idx <= 0} onClick={() => setPick(keys[idx - 1])} aria-label="Earlier"><Icon name="chevL" size={14} /></button><button className="icon-btn sm" disabled={idx >= keys.length - 1} onClick={() => setPick(keys[idx + 1])} aria-label="Later"><Icon name="chevR" size={14} /></button></div></div>
        <div className="row scroll" style={{ alignItems: "flex-end", gap: 5, height: 150, paddingTop: 16 }}>
          {totals.map((t) => (
            <button key={t.k} onClick={() => setPick(t.k)} style={{ flex: "1 0 22px", maxWidth: 64, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 6, opacity: t.k === month ? 1 : 0.55, transition: "opacity var(--med)" }} title={`${MONTHS[+t.k.slice(5) - 1]} ${t.k.slice(0, 4)}`}>
              <div style={{ width: "100%", display: "flex", flexDirection: "column-reverse", borderRadius: 5, overflow: "hidden", minHeight: 3, outline: t.k === month ? "1.5px solid var(--ink-2)" : "none", outlineOffset: 2 }}>{t.parts.filter((p) => p.n).map((p) => <div key={p.w} style={{ height: Math.max(3, (p.n / max) * 100), background: `var(--hue-${p.w})` }} />)}{!t.parts.some((p) => p.n) && <div style={{ height: 3, background: "var(--plate-3)" }} />}</div>
              <span className="mono" style={{ fontSize: 9.5, color: t.k === month ? "var(--ink)" : "var(--ink-4)", whiteSpace: "nowrap" }}>{MONTHS[+t.k.slice(5) - 1].slice(0, 3)} {t.k.slice(2, 4)}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: 36, alignItems: "start" }}>
        <div className="col gap4" style={{ position: "sticky", top: 0 }}>
          <h2 className="display" style={{ fontSize: 40 }}>{MONTHS[+month.slice(5) - 1]}<br /><span className="faint">{month.slice(0, 4)}</span></h2>
          {snap && <div className="col gap3">
            <span className="label">Your universe at the end of this month</span>
            {[["Files indexed", `${snap.files.toLocaleString()} · ${bytes(snap.size)}`], ["Courses · projects", `${snap.courses} · ${snap.projects}`], ["Deadlines completed (to date)", snap.done], ["Tasks finished (to date)", snap.tasks], ["Money in · out this month", snap.income || snap.spent ? `${money(snap.income, base, { compact: true })} · ${money(snap.spent, base, { compact: true })}` : "nothing recorded"]].map(([a, b]) => <div key={a as string} className="row between small"><span className="faint">{a}</span><span className="num">{b}</span></div>)}
            <span className="small faint">Counts are reconstructed from dates stored with each record; money figures are in each account's own currency, unconverted.</span>
          </div>}
        </div>
        <div className="col">
          {days.length === 0 && <p className="small faint">No recorded events in this month — only file imports were dated here.</p>}
          {days.map(([day, list]) => (
            <div key={day} style={{ display: "grid", gridTemplateColumns: "120px 1fr", gap: 16, padding: "12px 0", borderTop: "1px solid var(--line)" }}>
              <div className="col" style={{ gap: 0 }}><span>{fmtDate(day)}</span><span className="small faint">{plural(list.length, "event")}</span></div>
              <div className="col" style={{ gap: 2 }}>{list.map((e: any, i: number) => (
                <button key={i} className="list-row small" style={{ textAlign: "left", padding: "5px 8px" }} onClick={() => go(WORLD_OF[e.world] ?? "home")}>
                  <span className="dot" style={{ "--c": `var(--hue-${e.world})` } as any} /><span className="mono faint" style={{ width: 40 }}>{new Date(e.ts).toTimeString().slice(0, 5)}</span><span className="grow truncate">{e.title}</span>{e.detail && <span className="faint truncate" style={{ maxWidth: "40%" }}>{e.detail}</span>}
                </button>))}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

const UPCOMING = `
  SELECT substr(d.due_at, 1, 10) date, 'academy' world, d.kind, d.title, c.name detail FROM deadlines d LEFT JOIN courses c ON c.id = d.course_id WHERE d.done = 0
  UNION ALL SELECT m.date, 'projects', 'milestone', m.title, p.name FROM milestones m JOIN projects p ON p.id = m.project_id WHERE m.done = 0 AND p.status = 'active'
  UNION ALL SELECT t.due_date, 'projects', 'task', t.title, p.name FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.status != 'done' AND t.due_date IS NOT NULL AND p.status = 'active'
  UNION ALL SELECT r.next_date, 'finance', 'payment', r.title, NULL FROM recurring r WHERE r.active = 1
  UNION ALL SELECT g.due_date, CASE g.kind WHEN 'savings' THEN 'finance' ELSE 'home' END, 'goal', g.title, NULL FROM goals g WHERE g.done = 0 AND g.due_date IS NOT NULL
  UNION ALL SELECT s.date, 'academy', 'study', 'Study session', c.name FROM study_sessions s LEFT JOIN courses c ON c.id = s.course_id WHERE s.done = 0`;

function Ahead() {
  const go = useUI((s) => s.go);
  const [span, setSpan] = useState<"30" | "90">("30");
  const t = today(), end = ymd(addDays(new Date(), +span));
  const rows = useRows<any>(`SELECT * FROM (${UPCOMING}) WHERE date BETWEEN ? AND ? ORDER BY date`, [t, end]);
  const late = useRows<any>(`SELECT * FROM (${UPCOMING}) WHERE date < ? AND kind NOT IN ('study', 'payment') ORDER BY date DESC LIMIT 20`, [t]);
  const weeks = [...rows.reduce((g, e) => { const k = ymd(weekStart(parseLocal(e.date))); g.set(k, [...(g.get(k) ?? []), e]); return g; }, new Map<string, any[]>()).entries()];
  return (
    <div className="col gap4" style={{ maxWidth: 900 }}>
      <div className="row between"><p className="small faint" style={{ maxWidth: 560 }}>One line through everything with a date — coursework, project milestones, payments, goals and planned study. Nothing here is scored or counted against you.</p><Seg value={span} onChange={setSpan} options={[{ value: "30", label: "Next 30 days" }, { value: "90", label: "Next 90 days" }]} /></div>
      {late.length > 0 && <details className="plate" style={{ padding: "10px 14px" }}><summary className="small" style={{ cursor: "pointer" }}>{plural(late.length, "open item")} from earlier — reschedule or let go</summary><div className="col" style={{ gap: 2, marginTop: 8 }}>{late.map((e, i) => <button key={i} className="list-row small" style={{ textAlign: "left", padding: "5px 8px" }} onClick={() => go(e.world)}><span className="dot" style={{ "--c": `var(--hue-${e.world})` } as any} /><span className="grow truncate">{e.title}</span><span className="faint">{e.kind} · {relDay(e.date)}</span></button>)}</div></details>}
      {weeks.length === 0 ? <Empty icon="timeline" title="A clear stretch">Nothing with a date in this window. Deadlines, milestones, payments and goals will line up here.</Empty> : weeks.map(([wk, list]) => (
        <section key={wk} style={{ display: "grid", gridTemplateColumns: "150px 1fr", gap: 18 }}>
          <div className="col" style={{ gap: 0, paddingTop: 8 }}><span className="display" style={{ fontSize: 24 }}>{wk === ymd(weekStart(new Date())) ? "This week" : fmtDate(wk).slice(4)}</span><span className="small faint">{plural(list.length, "item")}</span></div>
          <div className="plate" style={{ padding: 6 }}>{list.map((e: any, i: number) => (
            <button key={i} className="list-row" style={{ width: "100%", textAlign: "left" }} onClick={() => go(e.world, e.world === "academy" ? { tab: "deadlines" } : e.kind === "payment" ? { tab: "recurring" } : undefined)}>
              <span className="dot" style={{ "--c": `var(--hue-${e.world})` } as any} /><span className="small faint" style={{ width: 84 }}>{fmtDate(e.date).slice(0, -4)}</span><div className="col grow" style={{ gap: 0 }}><span className="truncate">{e.title}</span>{e.detail && <span className="small faint truncate">{e.detail}</span>}</div><span className="chip">{e.kind}</span><span className="small faint" style={{ width: 80, textAlign: "right" }}>{relDay(e.date)}</span>
            </button>))}</div>
        </section>
      ))}
    </div>
  );
}

function Review() {
  const [mode, setMode] = useState<"week" | "month">("week");
  const [offset, setOffset] = useState(0);
  const now = new Date();
  const start = mode === "week" ? addDays(weekStart(now), offset * 7) : new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const end = mode === "week" ? addDays(start, 6) : new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const nextEnd = mode === "week" ? addDays(end, 7) : new Date(end.getFullYear(), end.getMonth() + 2, 0);
  const key = `${mode}:${ymd(start)}`, a = ymd(start), b = ymd(end);
  const done = useRows<any>(`SELECT * FROM (${EVENTS}) WHERE ts IS NOT NULL AND kind IN ('done', 'milestone', 'goal', 'project') AND ${localDay("ts")} BETWEEN ? AND ? ORDER BY ts`, [a, b]);
  const counts = useRows<any>(`SELECT (SELECT COUNT(*) FROM files WHERE ${localDay("imported_at")} BETWEEN ?1 AND ?2) files, (SELECT COUNT(*) FROM study_sessions WHERE date BETWEEN ?1 AND ?2) sessions, (SELECT COALESCE(SUM(end_min - start_min), 0) FROM study_sessions WHERE date BETWEEN ?1 AND ?2) minutes, (SELECT COUNT(*) FROM notes WHERE owner_type = 'capture' AND ${localDay("created_at")} BETWEEN ?1 AND ?2) captures, (SELECT COUNT(*) FROM transactions WHERE date BETWEEN ?1 AND ?2) txs`, [a, b])[0];
  const ahead = useRows<any>(`SELECT * FROM (${UPCOMING}) WHERE date > ? AND date <= ? AND kind != 'study' ORDER BY date LIMIT 12`, [b, ymd(nextEnd)]);
  const note = useRows<any>("SELECT * FROM notes WHERE owner_type = 'review' AND title = ? LIMIT 1", [key])[0];
  const [draft, setDraft] = useState<{ key: string; body: string } | null>(null);
  const body = draft?.key === key ? draft.body : note?.body ?? "";
  const save = async () => { if (draft?.key !== key) return; const t = Date.now(); if (note) await run("UPDATE notes SET body = ?, updated_at = ? WHERE id = ?", [draft.body, t, note.id]); else if (draft.body.trim()) await run("INSERT INTO notes(owner_type, title, body, created_at, updated_at) VALUES('review', ?, ?, ?, ?)", [key, draft.body, t, t]); };
  return (
    <div className="col gap5" style={{ maxWidth: 980 }}>
      <div className="row between">
        <div className="row"><button className="icon-btn" onClick={() => setOffset(offset - 1)} aria-label="Earlier"><Icon name="chevL" size={16} /></button><h2 className="display" style={{ fontSize: 32, minWidth: 300 }}>{mode === "week" ? `${fmtDate(start).slice(4)} – ${fmtDate(end).slice(4)}` : `${MONTHS[start.getMonth()]} ${start.getFullYear()}`}</h2><button className="icon-btn" disabled={offset >= 0} onClick={() => setOffset(offset + 1)} aria-label="Later"><Icon name="chevR" size={16} /></button></div>
        <Seg value={mode} onChange={(m) => { setMode(m); setOffset(0); }} options={[{ value: "week", label: "Weekly" }, { value: "month", label: "Monthly" }]} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28 }}>
        <div className="col gap4">
          <div className="col gap1"><span className="label good">What got done</span>{done.length ? done.map((e, i) => <div key={i} className="row small"><Icon name="check" size={13} style={{ color: "var(--good)", flex: "none" }} /><span className="grow truncate">{e.title.replace(/^(Completed|Finished): /, "")}</span><span className="faint">{fmtDate(new Date(e.ts)).slice(0, -4)}</span></div>) : <span className="small faint">Nothing was marked complete in this period — which says nothing about how it went. Some weeks are for attending, resting or thinking.</span>}</div>
          {counts && <div className="col gap1"><span className="label">Also in this period</span><span className="small dim">{[counts.files && plural(counts.files, "file") + " added", counts.sessions && `${plural(counts.sessions, "study session")} (${(counts.minutes / 60).toFixed(1)}h planned)`, counts.captures && plural(counts.captures, "thought") + " captured", counts.txs && plural(counts.txs, "transaction") + " recorded"].filter(Boolean).join(" · ") || "No other recorded activity."}</span></div>}
          <div className="col gap1"><span className="label">Coming next</span>{ahead.length ? ahead.map((e, i) => <div key={i} className="row small"><span className="dot" style={{ "--c": `var(--hue-${e.world})` } as any} /><span className="grow truncate">{e.title}</span><span className="faint">{e.kind} · {fmtDate(e.date).slice(0, -4)}</span></div>) : <span className="small faint">Nothing dated in the following {mode}.</span>}</div>
        </div>
        <div className="col gap1"><span className="label">Reflection</span>
          <textarea className="textarea grow" style={{ minHeight: 300 }} value={body} onChange={(e) => setDraft({ key, body: e.target.value })} onBlur={save} placeholder={"A few lines, only if they help.\n\nWhat went well?\nWhat was harder than expected?\nWhat matters most next " + mode + "?"} />
          <span className="small faint">{note ? `Saved ${ago(note.updated_at)}` : "Saved on this computer when you click away."} Private to you; optional, always.</span>
        </div>
      </div>
    </div>
  );
}

function Backups() {
  const list = useQ(() => call<any[]>("backup.list"), []);
  const info = useQ(() => call<any>("app.info"), []).data;
  const make = () => attempt(async () => { await call("backup.create"); list.reload(); }, "Backup created.");
  const restore = (name: string) => attempt(async () => { const r = await call<any>("backup.restore", { name }); useUI.getState().bump(); list.reload(); return r; }, "Restored. Your previous state was saved first as a safety backup.");
  const exportJson = () => attempt(async () => { const r = await call<any>("backup.export"); if (isTauri) await native.reveal(r.path); return r; }, "Exported everything you created to a readable JSON file.");
  return (
    <div className="col gap5" style={{ maxWidth: 900 }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <div className="plate pad lit col gap3"><Icon name="shield" size={22} className="hue" /><b>Back up now</b><span className="small dim">A complete, consistent snapshot of the database: courses, deadlines, finances, projects, notes, settings and the file index. Your original files are not copied — they stay where they are.</span><button className="btn primary" style={{ alignSelf: "flex-start" }} onClick={make}>Create backup</button></div>
        <div className="plate pad col gap3"><Icon name="download" size={22} className="hue" /><b>Export as readable JSON</b><span className="small dim">Everything you created, in an open format you can read or move elsewhere without this app.</span><button className="btn" style={{ alignSelf: "flex-start" }} onClick={exportJson}>Export data</button></div>
      </div>
      <div className="col gap1">
        <div className="row between"><span className="label">Snapshots on this computer</span><span className="small faint">An automatic snapshot is taken once a day when the app starts; the latest ten are kept.</span></div>
        {(list.data ?? []).length === 0 ? <p className="small faint" style={{ padding: "12px 0" }}>No backups yet.</p> : <div className="plate" style={{ padding: 6 }}>{list.data!.map((b) => (
          <div key={b.name} className="list-row">
            <Icon name="archive" size={16} style={{ color: "var(--ink-3)", flex: "none" }} />
            <div className="col grow" style={{ gap: 0 }}><span>{fmtDate(new Date(b.modified), "long")} · {new Date(b.modified).toTimeString().slice(0, 5)}</span><span className="small faint mono truncate">{b.name}</span></div>
            <span className="chip">{b.safety ? "before a restore" : b.auto ? "automatic" : "manual"}</span><span className="small faint num" style={{ width: 70, textAlign: "right" }}>{bytes(b.size)}</span>
            {isTauri && <button className="btn sm ghost" onClick={() => attempt(() => native.reveal(b.path))}>Show file</button>}
            <Confirm className="btn sm" label="Restore" icon="undo" onConfirm={() => restore(b.name)} />
          </div>))}</div>}
      </div>
      <p className="small faint selectable">Stored in <span className="mono">{info?.dataDir}</span>. Restoring replaces the current data with the snapshot, after first saving the current state so the restore itself can be undone.</p>
    </div>
  );
}

function Privacy() {
  const rows = useRows<any>("SELECT * FROM outbound_log ORDER BY ts DESC LIMIT 200");
  return (
    <div className="col gap4" style={{ maxWidth: 900 }}>
      <div className="plate pad lit row gap4"><Icon name="shield" size={26} className="hue" style={{ flex: "none" }} /><div className="col gap1"><b>Nothing leaves this computer on its own.</b><span className="small dim">Personal Universe has no telemetry, no account and no cloud. The single path outward is an AI handoff that you start and confirm: the app prepares a folder and opens a website; you paste and attach. Every such moment is listed below, permanently.</span></div></div>
      {rows.length === 0 ? <Empty icon="shield" title="The ledger is empty">No handoff has been prepared. Nothing has been sent anywhere.</Empty> : <div className="plate" style={{ padding: 6 }}>{rows.map((r) => { let files: string[] = []; try { files = JSON.parse(r.files); } catch { /* keep empty */ } return (
        <div key={r.id} className="list-row" style={{ alignItems: "flex-start" }}>
          <Icon name="send" size={15} style={{ color: "var(--ink-3)", marginTop: 3, flex: "none" }} />
          <div className="col grow" style={{ gap: 2 }}><span>{r.summary}</span>{files.length > 0 && <span className="small faint">{files.join(" · ")}</span>}{r.dir && <span className="mono faint selectable" style={{ fontSize: 10.5, wordBreak: "break-all" }}>{r.dir}</span>}</div>
          <span className="chip">{r.target}</span><span className="small faint" style={{ whiteSpace: "nowrap" }}>{ago(r.ts)}</span>
          {isTauri && r.dir && <button className="btn sm ghost" onClick={() => attempt(() => native.openPath(r.dir))}>Open folder</button>}
        </div>); })}</div>}
    </div>
  );
}
