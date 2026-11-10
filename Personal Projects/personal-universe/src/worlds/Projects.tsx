// Projects — work in motion. Each project is a workspace: a board, a timeline, notes and
// the files and course it belongs to.
import { useCallback, useEffect, useState } from "react";
import { log, run } from "../lib/backend";
import { daysUntil, fmtDate, parseLocal, relDay, today, ymd } from "../lib/dates";
import { plural } from "../lib/format";
import { useCourseFocus, useIntent, useRows } from "../lib/hooks";
import { attempt, useUI } from "../lib/store";
import { Icon } from "../ui/Icons";
import { Check, Confirm, Empty, Field, Modal, Ring, Seg, Tabs, useDrag } from "../ui/kit";
import { LinkedFiles } from "../shell/Files";
import { Swatches } from "../shell/QuickAdd";

const COLS = [["todo", "To do"], ["doing", "In progress"], ["done", "Done"]] as const;
const PRI: Record<number, [string, string]> = { 1: ["Low", "var(--ink-3)"], 2: ["Normal", "var(--hue)"], 3: ["High", "var(--bad)"] };

export default function Projects() {
  const set = useUI((s) => s.set);
  const [id, setId] = useState<number | null>(null);
  const [show, setShow] = useState<"active" | "all">("active");
  useIntent("projects", (i) => { if (i.id) setId(i.id); });
  const projects = useRows<any>("SELECT p.*, c.name course, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id) total, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'done') done, (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'doing') doing, (SELECT MIN(date) FROM milestones m WHERE m.project_id = p.id AND m.done = 0) next_ms FROM projects p LEFT JOIN courses c ON c.id = p.course_id ORDER BY p.status = 'done', p.priority DESC, p.due_date IS NULL, p.due_date");
  const p = projects.find((x) => x.id === id);
  if (p) return <Workspace p={p} back={() => setId(null)} />;
  const [focus] = useCourseFocus();
  const list = projects.filter((x) => (show === "all" || x.status === "active") && (!focus || x.course_id === focus.id));
  return (
    <>
      <div className="world-head">
        <div><h1 className="display">Projects</h1><p className="sub">{focus ? `Showing projects for ${focus.name} only — leave course focus in the top bar to see everything.` : "Objectives, tasks, milestones, notes and files — together, and connected to the course they belong to."}</p></div>
        <div className="row"><Seg value={show} onChange={setShow} options={[{ value: "active", label: "Active" }, { value: "all", label: "All" }]} /><button className="btn primary" onClick={() => set({ quick: { type: "project" } })}><Icon name="plus" size={14} />New project</button></div>
      </div>
      <div className="world-body">
        {list.length === 0 ? <Empty icon="projects" title={projects.length ? "No active projects" : "No projects yet"} action={<button className="btn primary" onClick={() => set({ quick: { type: "project" } })}>Start a project</button>}>A semester project, your FYP, a lab build, something personal. Give it an objective and break it into tasks and milestones.</Empty> : (
          <div className="stagger" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(330px, 1fr))", gap: 16 }}>
            {list.map((p) => (
              <button key={p.id} className="plate hover lit col" style={{ padding: 20, textAlign: "left", gap: 10, "--hue": p.color, opacity: p.status === "active" ? 1 : 0.6 } as any} onClick={() => setId(p.id)}>
                <div className="row between gap4" style={{ alignItems: "flex-start" }}>
                  <div className="col" style={{ gap: 4, minWidth: 0 }}><span className="label hue">{p.status === "active" ? p.course ?? "Project" : p.status}</span><h3 className="display" style={{ fontSize: 28 }}>{p.name}</h3></div>
                  <Ring value={p.total ? p.done / p.total : 0} size={52} stroke={4} color={p.color} />
                </div>
                <p className="small dim clamp2" style={{ minHeight: 36 }}>{p.objective || "No objective written yet."}</p>
                <div className="row gap3 small faint"><span>{p.done}/{p.total} tasks</span>{p.doing > 0 && <span>{p.doing} in progress</span>}{p.next_ms && <span className={daysUntil(p.next_ms) < 0 ? "bad" : "hue"}>milestone {relDay(p.next_ms)}</span>}{p.due_date && <span style={{ marginLeft: "auto" }}>due {fmtDate(p.due_date)}</span>}</div>
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function Workspace({ p, back }: { p: any; back: () => void }) {
  const [tab, setTab] = useState<"board" | "timeline" | "notes" | "files" | "about">("board");
  const tasks = useRows<any>("SELECT * FROM tasks WHERE project_id = ? ORDER BY sort, id", [p.id]);
  const milestones = useRows<any>("SELECT * FROM milestones WHERE project_id = ? ORDER BY date", [p.id]);
  const done = tasks.filter((t) => t.status === "done").length;
  return (
    <div style={{ display: "contents", "--hue": p.color } as any}>
      <div className="world-head">
        <div className="col gap1"><button className="row small faint" onClick={back}><Icon name="chevL" size={13} />All projects</button><h1 className="display">{p.name}</h1>{p.objective && <p className="sub" style={{ marginTop: 0 }}>{p.objective}</p>}</div>
        <div className="row gap4"><div className="col" style={{ gap: 0, textAlign: "right" }}><span className="small">{done}/{tasks.length} tasks{p.due_date ? ` · due ${relDay(p.due_date)}` : ""}</span><span className="small faint">{milestones.filter((m) => !m.done).length} milestones ahead</span></div><Ring value={tasks.length ? done / tasks.length : 0} size={54} stroke={4.5} /></div>
      </div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "board", label: "Board", count: tasks.length - done }, { id: "timeline", label: "Timeline" }, { id: "notes", label: "Notes" }, { id: "files", label: "Files" }, { id: "about", label: "Details" }]} />
      <div className="world-body">
        {tab === "board" && <Board p={p} tasks={tasks} />}
        {tab === "timeline" && <Timeline p={p} tasks={tasks} milestones={milestones} />}
        {tab === "notes" && <Notes owner={p.id} />}
        {tab === "files" && <div className="plate pad lit"><LinkedFiles type="project" id={p.id} /></div>}
        {tab === "about" && <About p={p} back={back} />}
      </div>
    </div>
  );
}

function Board({ p, tasks }: { p: any; tasks: any[] }) {
  const [edit, setEdit] = useState<any>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const drag = useDrag<any>(useCallback((t, col, index) => {
    if (!COLS.some((c) => c[0] === col)) return;
    const list = tasks.filter((x) => x.status === col && x.id !== t.id);
    const before = list[index - 1]?.sort ?? (list[0]?.sort ?? Date.now()) - 2000, after = list[index]?.sort ?? before + 2000;
    void run("UPDATE tasks SET status = ?, sort = ?, done_at = ? WHERE id = ?", [col, (before + after) / 2, col === "done" ? t.done_at ?? Date.now() : null, t.id]);
    if (col === "done" && t.status !== "done") void log("projects", "done", `Finished: ${t.title}`, { type: "project", id: p.id }, p.name);
  }, [tasks, p]));
  const add = (col: string) => { const title = (draft[col] ?? "").trim(); if (!title) return; void run("INSERT INTO tasks(project_id, title, status, sort, created_at) VALUES(?,?,?,?,?)", [p.id, title, col, Date.now(), Date.now()]); setDraft({ ...draft, [col]: "" }); };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, alignItems: "start" }}>
      {COLS.map(([col, label]) => { const list = tasks.filter((t) => t.status === col); return (
        <div key={col} data-drop={col} className="plate col" style={{ padding: 12, gap: 8, minHeight: 300, borderColor: drag.over === col ? "var(--hue)" : undefined }}>
          <div className="row between" style={{ padding: "2px 6px" }}><span className="label">{label}</span><span className="small faint num">{list.length}</span></div>
          {list.map((t, i) => (
            <div key={t.id} data-drag-index={i} {...drag.handle(t, t.title)} className="plate hover col" onClick={() => setEdit(t)} style={{ padding: "10px 12px", gap: 6, borderRadius: 12, cursor: "grab", opacity: drag.dragging?.id === t.id ? 0.35 : 1, background: "var(--plate-2)", touchAction: "none" }}>
              <span style={{ textDecoration: col === "done" ? "line-through" : undefined, color: col === "done" ? "var(--ink-3)" : undefined }}>{t.title}</span>
              {(t.due_date || t.assignee || t.priority !== 2) && <div className="row gap1 wrap">{t.priority !== 2 && <span className="chip tint" style={{ "--c": PRI[t.priority][1], height: 18, fontSize: 10 } as any}>{PRI[t.priority][0]}</span>}{t.due_date && <span className={"chip " + (col !== "done" && daysUntil(t.due_date) < 0 ? "bad" : "")} style={{ height: 18, fontSize: 10 }}><Icon name="calendar" size={9} />{fmtDate(t.due_date)}</span>}{t.assignee && <span className="chip" style={{ height: 18, fontSize: 10 }}>{t.assignee}</span>}</div>}
            </div>
          ))}
          <input className="input bare small" style={{ padding: "8px 6px" }} value={draft[col] ?? ""} onChange={(e) => setDraft({ ...draft, [col]: e.target.value })} onKeyDown={(e) => e.key === "Enter" && add(col)} placeholder="+ Add a task, press Enter" />
        </div>); })}
      {drag.ghost}
      {edit && <TaskForm t={edit} team={p.team} onClose={() => setEdit(null)} />}
    </div>
  );
}

function TaskForm({ t, team, onClose }: { t: any; team: string; onClose: () => void }) {
  const [f, setF] = useState({ ...t, due_date: t.due_date ?? "" });
  const people = team.split(",").map((s: string) => s.trim()).filter(Boolean);
  const save = () => attempt(async () => { if (!f.title.trim()) throw new Error("A task needs a title."); await run("UPDATE tasks SET title=?, status=?, priority=?, due_date=?, assignee=?, done_at=? WHERE id=?", [f.title.trim(), f.status, +f.priority, f.due_date || null, f.assignee, f.status === "done" ? t.done_at ?? Date.now() : null, t.id]); onClose(); });
  return (
    <Modal title="Task" onClose={onClose} foot={<><button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={() => attempt(async () => { await run("DELETE FROM tasks WHERE id = ?", [t.id]); onClose(); })}>Delete</button><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      <Field label="Title"><input className="input" autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} /></Field>
      <div className="grid2">
        <Field label="Status"><Seg value={f.status} onChange={(v) => setF({ ...f, status: v })} options={COLS.map(([value, label]) => ({ value, label }))} /></Field>
        <Field label="Priority"><Seg value={String(f.priority)} onChange={(v) => setF({ ...f, priority: +v })} options={[{ value: "1", label: "Low" }, { value: "2", label: "Normal" }, { value: "3", label: "High" }]} /></Field>
        <Field label="Due"><input className="input" type="date" value={f.due_date} onChange={(e) => setF({ ...f, due_date: e.target.value })} /></Field>
        <Field label="Assigned to"><input className="input" list="pu-team" value={f.assignee} onChange={(e) => setF({ ...f, assignee: e.target.value })} placeholder="Me" /><datalist id="pu-team">{people.map((n: string) => <option key={n} value={n} />)}</datalist></Field>
      </div>
    </Modal>
  );
}

function Timeline({ p, tasks, milestones }: { p: any; tasks: any[]; milestones: any[] }) {
  const [title, setTitle] = useState(""); const [date, setDate] = useState("");
  const dated = tasks.filter((t) => t.due_date);
  const all = [p.start_date ?? ymd(new Date(p.created_at)), p.due_date, today(), ...milestones.map((m) => m.date), ...dated.map((t) => t.due_date)].filter(Boolean).sort();
  const t0 = parseLocal(all[0]).getTime() - 3 * 86400000, t1 = parseLocal(all.at(-1)!).getTime() + 5 * 86400000;
  const x = (d: string) => `${((parseLocal(d).getTime() - t0) / (t1 - t0)) * 100}%`;
  const months: string[] = []; for (let d = new Date(new Date(t0).getFullYear(), new Date(t0).getMonth() + 1, 1); d.getTime() < t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) months.push(ymd(d));
  const add = () => attempt(async () => { if (!title.trim() || !date) throw new Error("A milestone needs a name and a date."); await run("INSERT INTO milestones(project_id, title, date) VALUES(?,?,?)", [p.id, title.trim(), date]); setTitle(""); setDate(""); });
  return (
    <div className="col gap5">
      <div className="plate pad" style={{ paddingBottom: 30 }}>
        <div style={{ position: "relative", height: 170, margin: "0 20px" }}>
          <div style={{ position: "absolute", left: 0, right: 0, top: 84, height: 1.5, background: "var(--line-2)" }} />
          {p.due_date && <div style={{ position: "absolute", left: x(all[0]), width: `calc(${x(p.due_date)} - ${x(all[0])})`, top: 83, height: 3, borderRadius: 3, background: "color-mix(in srgb, var(--hue) 50%, transparent)" }} />}
          {months.map((m) => <div key={m} style={{ position: "absolute", left: x(m), top: 60, bottom: 0 }}><div style={{ width: 1, height: 50, background: "var(--line)" }} /><span className="mono faint" style={{ fontSize: 9.5, position: "absolute", top: 104, transform: "translateX(-50%)", whiteSpace: "nowrap" }}>{fmtDate(m, "month").slice(0, 3)} {m.slice(2, 4)}</span></div>)}
          <div style={{ position: "absolute", left: x(today()), top: 30, height: 80, width: 1.5, background: "var(--hue)", boxShadow: "0 0 10px var(--hue)" }}><span className="label hue" style={{ position: "absolute", top: -16, transform: "translateX(-50%)", fontSize: 9 }}>today</span></div>
          {milestones.map((m, i) => <div key={m.id} title={`${m.title} · ${fmtDate(m.date, "long")}`} style={{ position: "absolute", left: x(m.date), top: i % 2 ? 8 : 34, transform: "translateX(-50%)", display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}><span className="small truncate" style={{ maxWidth: 140, opacity: m.done ? 0.5 : 1 }}>{m.title}</span><div style={{ width: 1, height: i % 2 ? 54 : 28, background: "var(--line-2)" }} /><div style={{ width: 13, height: 13, transform: "rotate(45deg)", background: m.done ? "var(--good)" : daysUntil(m.date) < 0 ? "var(--bad)" : "var(--hue)", borderRadius: 2, marginTop: -4 }} /></div>)}
          {dated.map((t) => <div key={t.id} title={`${t.title} · due ${fmtDate(t.due_date)}`} style={{ position: "absolute", left: x(t.due_date), top: 122, transform: "translateX(-50%)", width: 8, height: 8, borderRadius: "50%", background: t.status === "done" ? "var(--good)" : "var(--ink-2)" }} />)}
          {p.due_date && <div style={{ position: "absolute", left: x(p.due_date), top: 70, transform: "translateX(-50%)" }} title={`Project due ${fmtDate(p.due_date, "long")}`}><Icon name="flag" size={18} style={{ color: "var(--hue)" }} /></div>}
        </div>
        <div className="row gap4 small faint" style={{ justifyContent: "center", marginTop: 6 }}><span className="row gap1"><i style={{ width: 9, height: 9, transform: "rotate(45deg)", background: "var(--hue)" }} />milestone</span><span className="row gap1"><i className="dot" style={{ "--c": "var(--ink-2)" } as any} />dated task</span><span className="row gap1"><Icon name="flag" size={12} />project due date</span></div>
      </div>
      <div className="col gap3" style={{ maxWidth: 760 }}>
        <span className="label">Milestones</span>
        {milestones.map((m) => <div key={m.id} className="list-row plate"><Check on={!!m.done} onChange={(v) => { void run("UPDATE milestones SET done = ? WHERE id = ?", [v ? 1 : 0, m.id]); if (v) void log("projects", "milestone", `Reached milestone: ${m.title}`, { type: "project", id: p.id }, p.name); }} /><span className="grow" style={{ textDecoration: m.done ? "line-through" : undefined }}>{m.title}</span><input className="input bare small" type="date" style={{ width: 130 }} value={m.date} onChange={(e) => e.target.value && run("UPDATE milestones SET date = ? WHERE id = ?", [e.target.value, m.id])} aria-label="Milestone date" /><span className={"small " + (!m.done && daysUntil(m.date) < 0 ? "bad" : "faint")} style={{ width: 90, textAlign: "right" }}>{m.done ? "reached" : relDay(m.date)}</span><Confirm onConfirm={() => run("DELETE FROM milestones WHERE id = ?", [m.id])} /></div>)}
        <div className="row gap3"><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New milestone — e.g. Proposal defence" onKeyDown={(e) => e.key === "Enter" && add()} /><input className="input" type="date" style={{ width: 170 }} value={date} onChange={(e) => setDate(e.target.value)} /><button className="btn" onClick={add}>Add milestone</button></div>
      </div>
    </div>
  );
}

function Notes({ owner }: { owner: number }) {
  const notes = useRows<any>("SELECT * FROM notes WHERE owner_type = 'project' AND owner_id = ? ORDER BY updated_at DESC", [owner]);
  const [id, setId] = useState<number | null>(null);
  const [draft, setDraft] = useState<{ title: string; body: string } | null>(null);
  const cur = notes.find((n) => n.id === id) ?? notes[0];
  useEffect(() => setDraft(null), [cur?.id]);
  const create = async () => { const now = Date.now(); const r = await run("INSERT INTO notes(owner_type, owner_id, title, body, created_at, updated_at) VALUES('project', ?, 'Untitled note', '', ?, ?)", [owner, now, now]); setId(r.lastId); };
  const save = () => { if (draft && cur) void run("UPDATE notes SET title = ?, body = ?, updated_at = ? WHERE id = ?", [draft.title || "Untitled note", draft.body, Date.now(), cur.id]); };
  if (!notes.length) return <Empty icon="note" title="No notes yet" action={<button className="btn primary" onClick={create}>Write the first note</button>}>Meeting notes, decisions, ideas, links — kept with the project.</Empty>;
  const v = draft ?? { title: cur.title, body: cur.body };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "240px 1fr", gap: 24, minHeight: 420 }}>
      <div className="col" style={{ gap: 2 }}><button className="btn sm" style={{ marginBottom: 8 }} onClick={create}><Icon name="plus" size={13} />New note</button>{notes.map((n) => <button key={n.id} className={"list-row small" + (n.id === cur.id ? " on" : "")} style={{ textAlign: "left" }} onClick={() => { save(); setId(n.id); }}><div className="col grow" style={{ gap: 0 }}><span className="truncate">{n.title}</span><span className="faint" style={{ fontSize: 10.5 }}>{fmtDate(new Date(n.updated_at))}</span></div></button>)}</div>
      <div className="col gap3"><div className="row"><input className="input bare display" style={{ fontSize: 30 }} value={v.title} onChange={(e) => setDraft({ ...v, title: e.target.value })} onBlur={save} aria-label="Note title" /><Confirm onConfirm={() => { void run("DELETE FROM notes WHERE id = ?", [cur.id]); setId(null); }} /></div>
        <textarea className="textarea grow" style={{ minHeight: 360 }} value={v.body} onChange={(e) => setDraft({ ...v, body: e.target.value })} onBlur={save} placeholder="Write here. Saved on this computer when you click away." /></div>
    </div>
  );
}

function About({ p, back }: { p: any; back: () => void }) {
  const courses = useRows<any>("SELECT id, name FROM courses WHERE archived = 0 ORDER BY name");
  const deadlines = useRows<any>("SELECT * FROM deadlines WHERE project_id = ? ORDER BY due_at", [p.id]);
  const [f, setF] = useState({ ...p, due_date: p.due_date ?? "", start_date: p.start_date ?? "", course_id: p.course_id ?? "" });
  const save = (patch: any = {}) => { const n = { ...f, ...patch }; setF(n); void run("UPDATE projects SET name=?, objective=?, status=?, color=?, priority=?, start_date=?, due_date=?, course_id=?, team=? WHERE id=?", [n.name.trim() || p.name, n.objective, n.status, n.color, +n.priority, n.start_date || null, n.due_date || null, n.course_id ? +n.course_id : null, n.team, p.id]); };
  return (
    <div className="col gap4" style={{ maxWidth: 720 }}>
      <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} onBlur={() => save()} /></Field>
      <Field label="Objective"><textarea className="textarea" rows={3} value={f.objective} onChange={(e) => setF({ ...f, objective: e.target.value })} onBlur={() => save()} placeholder="What does done look like?" /></Field>
      <div className="grid2">
        <Field label="Status"><Seg value={f.status} onChange={(v) => { save({ status: v }); if (v === "done") void log("projects", "project", `Completed project ${p.name}`, { type: "project", id: p.id }); }} options={[{ value: "active", label: "Active" }, { value: "paused", label: "Paused" }, { value: "done", label: "Done" }]} /></Field>
        <Field label="Priority"><Seg value={String(f.priority)} onChange={(v) => save({ priority: +v })} options={[{ value: "1", label: "Low" }, { value: "2", label: "Normal" }, { value: "3", label: "High" }]} /></Field>
        <Field label="Started"><input className="input" type="date" value={f.start_date} onChange={(e) => save({ start_date: e.target.value })} /></Field>
        <Field label="Due"><input className="input" type="date" value={f.due_date} onChange={(e) => save({ due_date: e.target.value })} /></Field>
        <Field label="Course"><select className="select" value={f.course_id} onChange={(e) => save({ course_id: e.target.value })}><option value="">None</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
        <Field label="Team (comma-separated)"><input className="input" value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} onBlur={() => save()} /></Field>
      </div>
      <Field label="Colour"><Swatches value={f.color} onChange={(color) => save({ color })} /></Field>
      <div className="col gap1"><div className="row between"><span className="label">Academic deadlines for this project</span><button className="btn sm" onClick={() => useUI.getState().set({ quick: { type: "deadline", init: { project_id: p.id, course_id: p.course_id ?? "", kind: "milestone" } } })}><Icon name="plus" size={12} />Add</button></div>{deadlines.length ? deadlines.map((d) => <div key={d.id} className="row between small" style={{ opacity: d.done ? 0.5 : 1 }}><span>{d.title} <span className="faint">· {d.kind}</span></span><span className="faint">{fmtDate(d.due_at)} · {relDay(d.due_at)}</span></div>) : <span className="small faint">None. {plural(0, "deadline")} linked.</span>}</div>
      <hr className="hr" /><div className="row"><Confirm className="btn ghost danger" label="Delete project" onConfirm={() => attempt(async () => { await run("DELETE FROM notes WHERE owner_type = 'project' AND owner_id = ?", [p.id]); await run("DELETE FROM projects WHERE id = ?", [p.id]); back(); })} /><span className="small faint">Removes its tasks, milestones and notes. Linked files are untouched.</span></div>
    </div>
  );
}
