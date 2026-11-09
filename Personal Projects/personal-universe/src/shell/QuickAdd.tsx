// Quick-create dialogs shared by every world and by the command bar.
import { useEffect, useState } from "react";
import { batch, log, q, q1, run } from "../lib/backend";
import { capture, guessCategory } from "../lib/actions";
import { today, ymdhm } from "../lib/dates";
import { CATEGORIES } from "../lib/finance";
import { PALETTE } from "../lib/format";
import { useRows } from "../lib/hooks";
import { attempt, toast, useUI } from "../lib/store";
import { Field, Modal, Seg } from "../ui/kit";

export const DEADLINE_KINDS = ["assignment", "quiz", "exam", "presentation", "lab", "milestone", "reminder", "event"];

export function QuickAdd() {
  const quick = useUI((s) => s.quick)!;
  const close = () => useUI.getState().set({ quick: null });
  if (quick.type === "deadline") return <DeadlineForm init={quick.init} close={close} />;
  if (quick.type === "tx") return <TxForm init={quick.init} close={close} />;
  if (quick.type === "project") return <ProjectForm init={quick.init} close={close} />;
  if (quick.type === "course") return <CourseForm init={quick.init} close={close} />;
  return <CaptureForm close={close} />;
}

function useForm<T extends object>(initial: T) {
  const [v, setV] = useState<T>(initial);
  return [v, (patch: Partial<T>) => setV((old) => ({ ...old, ...patch })), setV] as const;
}

function DeadlineForm({ init, close }: { init?: any; close: () => void }) {
  const courses = useRows<any>("SELECT id, name, code FROM courses WHERE archived = 0 ORDER BY name");
  const projects = useRows<any>("SELECT id, name FROM projects WHERE status != 'done' ORDER BY name");
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(23, 59, 0, 0);
  const [f, set, replace] = useForm({ id: 0, title: "", kind: "assignment", due_at: ymdhm(tomorrow), course_id: "", project_id: "", est_hours: "", priority: "2", notes: "", ...init });
  useEffect(() => {
    if (init?.id) q1<any>("SELECT * FROM deadlines WHERE id = ?", [init.id]).then((d) => d && replace({ ...d, course_id: d.course_id ?? "", project_id: d.project_id ?? "", est_hours: d.est_hours || "", priority: String(d.priority) }));
    // eslint-disable-next-line
  }, []);
  const save = () => attempt(async () => {
    if (!f.title.trim()) throw new Error("Give it a title first.");
    if (!f.due_at) throw new Error("Choose a date.");
    const p = [f.title.trim(), f.kind, f.course_id ? +f.course_id : null, f.project_id ? +f.project_id : null, f.due_at, +f.est_hours || 0, +f.priority, f.notes];
    if (f.id) await run("UPDATE deadlines SET title=?, kind=?, course_id=?, project_id=?, due_at=?, est_hours=?, priority=?, notes=? WHERE id=?", [...p, f.id]);
    else { const r = await run("INSERT INTO deadlines(title, kind, course_id, project_id, due_at, est_hours, priority, notes, created_at) VALUES(?,?,?,?,?,?,?,?,?)", [...p, Date.now()]); void log("academy", "deadline", `Added ${f.kind}: ${f.title.trim()}`, { type: "deadline", id: r.lastId }); }
    close();
  });
  return (
    <Modal title={f.id ? "Edit deadline" : "New deadline"} sub="Assignments, exams, reminders — anything with a date." onClose={close}
      foot={<>{f.id ? <button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={() => attempt(async () => { await run("DELETE FROM deadlines WHERE id = ?", [f.id]); close(); })}>Delete</button> : null}<button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>{f.id ? "Save" : "Add deadline"}</button></>}>
      <Field label="Title"><input className="input" autoFocus value={f.title} onChange={(e) => set({ title: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="e.g. Database assignment 3" /></Field>
      <div className="row wrap gap1">{DEADLINE_KINDS.map((k) => <button key={k} className={"chip" + (f.kind === k ? " on" : "")} onClick={() => set({ kind: k })}>{k}</button>)}</div>
      <div className="grid2">
        <Field label="Due"><input className="input" type="datetime-local" value={f.due_at} onChange={(e) => set({ due_at: e.target.value })} /></Field>
        <Field label="Estimated effort (hours)" hint="Optional — used by the workload planner"><input className="input" type="number" min="0" step="0.5" value={f.est_hours} onChange={(e) => set({ est_hours: e.target.value })} placeholder="default by type" /></Field>
        <Field label="Course"><select className="select" value={f.course_id} onChange={(e) => set({ course_id: e.target.value })}><option value="">None</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.code ? c.code + " · " : ""}{c.name}</option>)}</select></Field>
        <Field label="Project"><select className="select" value={f.project_id} onChange={(e) => set({ project_id: e.target.value })}><option value="">None</option>{projects.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <Field label="Priority"><Seg value={f.priority} onChange={(v) => set({ priority: v })} options={[{ value: "1", label: "Low" }, { value: "2", label: "Normal" }, { value: "3", label: "High" }]} /></Field>
      <Field label="Notes"><textarea className="textarea" rows={2} value={f.notes} onChange={(e) => set({ notes: e.target.value })} /></Field>
    </Modal>
  );
}

function TxForm({ init, close }: { init?: any; close: () => void }) {
  const accounts = useRows<any>("SELECT * FROM accounts WHERE archived = 0 ORDER BY kind = 'liability', id");
  const used = useRows<any>("SELECT category, COUNT(*) n FROM transactions GROUP BY category ORDER BY n DESC LIMIT 30");
  const [f, set, replace] = useForm({ id: 0, mode: "expense", amount: "", account_id: "", to_id: "", to_amount: "", date: today(), category: "", payee: "", note: "", ...init });
  useEffect(() => {
    if (init?.id) q1<any>("SELECT * FROM transactions WHERE id = ?", [init.id]).then((t) => t && replace({ ...f, ...t, mode: t.amount < 0 ? "expense" : "income", amount: String(Math.abs(t.amount)), account_id: String(t.account_id) }));
    // eslint-disable-next-line
  }, []);
  const acct = accounts.find((a) => String(a.id) === String(f.account_id)) ?? accounts[0];
  const to = accounts.find((a) => String(a.id) === String(f.to_id));
  const cats = [...new Set([...used.map((u) => u.category), ...CATEGORIES])].filter((c) => c !== "Transfer");
  const save = () => attempt(async () => {
    const amt = parseFloat(f.amount);
    if (!acct) throw new Error("Create an account first.");
    if (!(amt > 0)) throw new Error("Enter an amount greater than zero.");
    const now = Date.now();
    if (f.mode === "transfer") {
      if (!to || to.id === acct.id) throw new Error("Choose a different destination account.");
      const received = to.currency === acct.currency ? amt : parseFloat(f.to_amount);
      if (!(received > 0)) throw new Error(`Enter the amount received in ${to.currency}.`);
      await batch([
        { sql: "INSERT INTO transactions(account_id, date, amount, category, payee, note, transfer_id, created_at) VALUES(?,?,?,?,?,?,?,?)", params: [acct.id, f.date, -amt, "Transfer", `To ${to.name}`, f.note, now, now] },
        { sql: "INSERT INTO transactions(account_id, date, amount, category, payee, note, transfer_id, created_at) VALUES(?,?,?,?,?,?,?,?)", params: [to.id, f.date, received, "Transfer", `From ${acct.name}`, f.note, now, now] },
      ]);
    } else {
      const signed = f.mode === "expense" ? -amt : amt;
      const cat = f.category.trim() || guessCategory(f.payee);
      if (f.id) await run("UPDATE transactions SET account_id=?, date=?, amount=?, category=?, payee=?, note=? WHERE id=?", [acct.id, f.date, signed, cat, f.payee, f.note, f.id]);
      else { const r = await run("INSERT INTO transactions(account_id, date, amount, category, payee, note, created_at) VALUES(?,?,?,?,?,?,?)", [acct.id, f.date, signed, cat, f.payee, f.note, now]); void log("finance", "tx", `${signed < 0 ? "Spent" : "Received"} ${Math.abs(signed).toLocaleString()} ${acct.currency}`, { type: "tx", id: r.lastId }, f.payee || cat); }
    }
    close();
  });
  if (!accounts.length) return (
    <Modal title="New transaction" onClose={close} foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={() => { close(); useUI.getState().go("finance", { tab: "accounts", action: "new" }); }}>Create an account</button></>}>
      <p className="dim">Transactions belong to an account — a wallet, a bank account, anything that holds money. Create your first one and come straight back.</p>
    </Modal>
  );
  return (
    <Modal title={f.id ? "Edit transaction" : "New transaction"} onClose={close}
      foot={<>{f.id ? <button className="btn ghost danger" style={{ marginRight: "auto" }} onClick={() => attempt(async () => { await run("DELETE FROM transactions WHERE id = ?", [f.id]); close(); })}>Delete</button> : null}<button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      {!f.id && <Seg value={f.mode} onChange={(v) => set({ mode: v })} options={[{ value: "expense", label: "Expense" }, { value: "income", label: "Income" }, { value: "transfer", label: "Transfer" }]} />}
      <div className="grid2">
        <Field label={`Amount (${acct?.currency ?? ""})`}><input className="input num" autoFocus type="number" min="0" step="any" value={f.amount} onChange={(e) => set({ amount: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="0" /></Field>
        <Field label="Date"><input className="input" type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
        <Field label={f.mode === "transfer" ? "From account" : "Account"}><select className="select" value={acct?.id ?? ""} onChange={(e) => set({ account_id: e.target.value })}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></Field>
        {f.mode === "transfer" ? (
          <Field label="To account"><select className="select" value={f.to_id} onChange={(e) => set({ to_id: e.target.value })}><option value="">Choose…</option>{accounts.filter((a) => a.id !== acct?.id).map((a) => <option key={a.id} value={a.id}>{a.name} · {a.currency}</option>)}</select></Field>
        ) : (
          <Field label="Category"><input className="input" list="pu-cats" value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder={guessCategory(f.payee)} /><datalist id="pu-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></Field>
        )}
      </div>
      {f.mode === "transfer" && to && acct && to.currency !== acct.currency && <Field label={`Amount received (${to.currency})`} hint="Different currencies: enter exactly what arrived, so no rate is assumed."><input className="input num" type="number" min="0" step="any" value={f.to_amount} onChange={(e) => set({ to_amount: e.target.value })} /></Field>}
      {f.mode !== "transfer" && <Field label={f.mode === "expense" ? "Paid to" : "Received from"}><input className="input" value={f.payee} onChange={(e) => set({ payee: e.target.value })} /></Field>}
      <Field label="Note"><input className="input" value={f.note} onChange={(e) => set({ note: e.target.value })} /></Field>
    </Modal>
  );
}

function ProjectForm({ init, close }: { init?: any; close: () => void }) {
  const courses = useRows<any>("SELECT id, name FROM courses WHERE archived = 0 ORDER BY name");
  const [f, set] = useForm({ name: "", objective: "", due_date: "", course_id: "", color: PALETTE[Math.floor(Math.random() * PALETTE.length)], team: "", ...init });
  const save = () => attempt(async () => {
    if (!f.name.trim()) throw new Error("Name the project first.");
    const r = await run("INSERT INTO projects(name, objective, color, start_date, due_date, course_id, team, created_at) VALUES(?,?,?,?,?,?,?,?)", [f.name.trim(), f.objective, f.color, today(), f.due_date || null, f.course_id ? +f.course_id : null, f.team, Date.now()]);
    void log("projects", "project", `Started project ${f.name.trim()}`, { type: "project", id: r.lastId });
    close();
    useUI.getState().go("projects", { id: r.lastId });
  });
  return (
    <Modal title="New project" sub="A workspace for tasks, milestones, notes and files." onClose={close} foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Create project</button></>}>
      <Field label="Name"><input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} placeholder="e.g. Final Year Project" /></Field>
      <Field label="Objective"><textarea className="textarea" rows={2} value={f.objective} onChange={(e) => set({ objective: e.target.value })} placeholder="What does done look like?" /></Field>
      <div className="grid2">
        <Field label="Target date"><input className="input" type="date" value={f.due_date} onChange={(e) => set({ due_date: e.target.value })} /></Field>
        <Field label="Linked course"><select className="select" value={f.course_id} onChange={(e) => set({ course_id: e.target.value })}><option value="">None</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
      </div>
      <Field label="Team" hint="Names separated by commas — used to assign tasks"><input className="input" value={f.team} onChange={(e) => set({ team: e.target.value })} placeholder="Just me" /></Field>
      <Field label="Colour"><Swatches value={f.color} onChange={(color) => set({ color })} /></Field>
    </Modal>
  );
}

function CourseForm({ init, close }: { init?: any; close: () => void }) {
  const [f, set, replace] = useForm({ id: 0, name: "", code: "", instructor: "", credits: "", color: PALETTE[Math.floor(Math.random() * PALETTE.length)], ...init });
  useEffect(() => { if (init?.id) q1<any>("SELECT * FROM courses WHERE id = ?", [init.id]).then((c) => c && replace({ ...c, credits: c.credits ?? "" })); /* eslint-disable-next-line */ }, []);
  const save = () => attempt(async () => {
    if (!f.name.trim()) throw new Error("Name the course first.");
    const p = [f.name.trim(), f.code.trim(), f.instructor.trim(), f.color, f.credits ? +f.credits : null];
    if (f.id) await run("UPDATE courses SET name=?, code=?, instructor=?, color=?, credits=? WHERE id=?", [...p, f.id]);
    else { const r = await run("INSERT INTO courses(name, code, instructor, color, credits, created_at) VALUES(?,?,?,?,?,?)", [...p, Date.now()]); void log("academy", "course", `Added course ${f.name.trim()}`, { type: "course", id: r.lastId }); useUI.getState().go("academy", { tab: "courses", id: r.lastId }); }
    close();
  });
  return (
    <Modal title={f.id ? "Edit course" : "New course"} onClose={close} foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>{f.id ? "Save" : "Add course"}</button></>}>
      <div className="grid2">
        <Field label="Course name"><input className="input" autoFocus value={f.name} onChange={(e) => set({ name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && save()} /></Field>
        <Field label="Code"><input className="input" value={f.code} onChange={(e) => set({ code: e.target.value })} placeholder="EE3001" /></Field>
        <Field label="Instructor"><input className="input" value={f.instructor} onChange={(e) => set({ instructor: e.target.value })} /></Field>
        <Field label="Credit hours"><input className="input" type="number" min="0" step="0.5" value={f.credits} onChange={(e) => set({ credits: e.target.value })} /></Field>
      </div>
      <Field label="Colour"><Swatches value={f.color} onChange={(color) => set({ color })} /></Field>
    </Modal>
  );
}

function CaptureForm({ close }: { close: () => void }) {
  const [text, setText] = useState("");
  const save = async () => { if (!text.trim()) return toast("Nothing to capture yet."); await capture(text); close(); };
  return (
    <Modal title="Capture" sub="Get it out of your head. Sort it later." onClose={close} foot={<><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={save}>Capture</button></>}>
      <textarea className="textarea" autoFocus rows={6} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => (e.ctrlKey || e.metaKey) && e.key === "Enter" && save()} placeholder="An idea, a link, something to remember…  (Ctrl + Enter to save)" />
    </Modal>
  );
}

export function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return <div className="row wrap">{PALETTE.map((c) => <button key={c} onClick={() => onChange(c)} aria-label={"Colour " + c} style={{ width: 24, height: 24, borderRadius: "50%", background: c, outline: value === c ? "2px solid var(--ink)" : "none", outlineOffset: 2, opacity: value === c ? 1 : 0.75 }} />)}</div>;
}
