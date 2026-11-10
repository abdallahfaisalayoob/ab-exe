// The Universal Action Engine: one field that searches everything and runs structured
// commands. All matching is local — pattern rules, fuzzy names and SQLite full-text search.
import { useEffect, useMemo, useRef, useState } from "react";
import { useCourseFocus } from "../lib/hooks";
import { call, log, native, q, run } from "../lib/backend";
import { capture, captureClipboard, guessCategory, pickAndImport, rescan } from "../lib/actions";
import { interpret, Interp } from "../lib/commands";
import { fmtDate, relDay, today } from "../lib/dates";
import { ftsQuery, fuzzy, money } from "../lib/format";
import { useDebounced, useQ, setting } from "../lib/hooks";
import { attempt, toast, useUI, WORLDS } from "../lib/store";
import { Icon, KIND_ICON } from "../ui/Icons";
import { JOKES, speak } from "../lib/orion";
import { startFocus } from "./Orion";

/** A course matches a title when its code or initials appear, or when all (at least two) of its name words do. */
export function courseMatch(title: string, c: { name: string; code: string }) {
  const words = title.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const name = c.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && w !== "and");
  if (c.code && words.includes(c.code.toLowerCase().replace(/\W/g, ""))) return 3;
  if (name.length > 1 && words.includes(name.map((w) => w[0]).join(""))) return 3;
  const hits = name.filter((w) => words.includes(w)).length;
  return name.length > 0 && hits === name.length ? 2 : hits >= 2 ? 1 : 0;
}

interface Item { key: string; group: string; title: string; sub?: string; icon: string; color?: string; hint?: string; run: () => void | Promise<unknown> }

export function Palette() {
  const { go, set } = useUI();
  const seed = useUI((s) => s.seed);
  const [text, setText] = useState(seed?.text ?? "");
  const auto = useRef(seed?.auto ? seed.text : null);
  const [, setFocusCourse] = useCourseFocus();
  useEffect(() => { useUI.setState({ seed: null }); }, []);
  const [sel, setSel] = useState(0);
  const [found, setFound] = useState<Item[]>([]);
  const query = useDebounced(text, 110);
  const listRef = useRef<HTMLDivElement>(null);
  const close = () => set({ palette: false });

  const ents = useQ(async () => {
    const [courses, projects, collections, prompts, accounts] = await Promise.all([
      q<{ id: number; name: string; code: string; color: string }>("SELECT id, name, code, color FROM courses WHERE archived = 0"),
      q<{ id: number; name: string; color: string }>("SELECT id, name, color FROM projects"),
      q<{ id: number; name: string }>("SELECT id, name FROM collections"),
      q<{ id: number; title: string; subject: string }>("SELECT id, title, subject FROM prompts"),
      q<{ id: number; name: string; currency: string; kind: string }>("SELECT id, name, currency, kind FROM accounts WHERE archived = 0 ORDER BY kind = 'liability', id"),
    ]);
    return { courses, projects, collections, prompts, accounts };
  }, []).data;

  const actions: Item[] = useMemo(() => [
    { key: "a-orion", group: "Actions", title: "ORION, brief me", sub: "Today's classes, deadlines, money and your one mission", icon: "orbit", color: "var(--hue-home)", run: () => set({ palette: false, orion: "brief" }) },
    { key: "a-focus", group: "Actions", title: "Start a 25-minute focus block", sub: "ORION keeps time and tells you when it is done", icon: "clock", run: () => { close(); startFocus("Focus block", 25); } },
    { key: "a-deadline", group: "Actions", title: "New deadline", sub: "Assignment, quiz, exam, reminder…", icon: "flag", hint: "Ctrl D", run: () => set({ palette: false, quick: { type: "deadline" } }) },
    { key: "a-tx", group: "Actions", title: "New transaction", sub: "Record income, an expense or a transfer", icon: "wallet", hint: "Ctrl E", run: () => set({ palette: false, quick: { type: "tx" } }) },
    { key: "a-project", group: "Actions", title: "New project", icon: "projects", run: () => set({ palette: false, quick: { type: "project" } }) },
    { key: "a-course", group: "Actions", title: "New course", icon: "academy", run: () => set({ palette: false, quick: { type: "course" } }) },
    { key: "a-capture", group: "Actions", title: "Capture a thought", sub: "Lands in your capture inbox", icon: "note", run: () => set({ palette: false, quick: { type: "capture" } }) },
    { key: "a-clip", group: "Actions", title: "Capture clipboard text", icon: "copy", hint: "Ctrl ⇧ V", run: () => { close(); return captureClipboard(); } },
    { key: "a-import", group: "Actions", title: "Import a folder", sub: "Indexes it in place — originals are never moved", icon: "folder", run: () => { close(); return pickAndImport("folder"); } },
    { key: "a-files", group: "Actions", title: "Import files", icon: "upload", run: () => { close(); return pickAndImport("files"); } },
    { key: "a-handoff", group: "Actions", title: "Prepare an AI handoff", sub: "Prompt library → ChatGPT or Claude", icon: "send", run: () => set({ palette: false, handoff: { fileIds: [] } }) },
    { key: "a-rescan", group: "Actions", title: "Rescan watched folders", icon: "repeat", run: () => { close(); return rescan(); } },
    { key: "a-backup", group: "Actions", title: "Create a backup now", icon: "shield", run: () => { close(); return attempt(() => call("backup.create"), "Backup created."); } },
    { key: "a-full", group: "Actions", title: "Toggle full screen", icon: "full", hint: "F11", run: () => { close(); return native.win("fullscreen"); } },
    { key: "a-settings", group: "Actions", title: "Open settings", icon: "gear", hint: "Ctrl ,", run: () => set({ palette: false, settings: true }) },
    ...WORLDS.map((w, i) => ({ key: "w-" + w.id, group: "Worlds", title: w.name, sub: w.blurb, icon: w.id, color: `var(--hue-${w.id})`, hint: `Ctrl ${i + 1}`, run: () => go(w.id) })),
  ], [go, set]);

  useEffect(() => {
    let live = true;
    (async () => {
      const t = query.trim();
      if (!t) { setFound([]); return; }
      const items: Item[] = [];
      // A few words with ORION.
      const o = t.toLowerCase().match(/^(?:hey |ok )?orion[,:]?\s*(.*)$/);
      if (o) {
        const ask = o[1], fm = ask.match(/focus(?: for)? (\d+)/);
        if (/joke|funny|laugh/.test(ask)) items.push({ key: "o-j", group: "ORION", title: "Tell me a joke", icon: "spark", color: "var(--hue-home)", run: () => { const j = JOKES[Math.floor(Math.random() * JOKES.length)]; close(); toast(j); speak(j); } });
        else if (/who are you|your name|what are you/.test(ask)) items.push({ key: "o-w", group: "ORION", title: "Who are you?", icon: "orbit", color: "var(--hue-home)", run: () => { const a = "ORION: Offline, Rather Intelligent, Organisational Navigator. I read your timetable, deadlines and ledger on this computer, and I never phone home."; close(); toast(a); speak(a); } });
        else if (/focus/.test(ask)) items.push({ key: "o-f", group: "ORION", title: `Start a ${fm ? fm[1] : 25}-minute focus block`, icon: "clock", color: "var(--hue-home)", run: () => { close(); startFocus("Focus block", fm ? +fm[1] : 25); } });
        else if (/wrap|night|done for/.test(ask)) items.push({ key: "o-n", group: "ORION", title: "Wrap up the day", sub: "What got done, what moves to tomorrow", icon: "orbit", color: "var(--hue-home)", run: () => set({ palette: false, orion: "wrap" }) });
        else items.push({ key: "o-b", group: "ORION", title: "Brief me", sub: "Try also: “orion joke”, “orion focus 45”, “orion who are you”", icon: "orbit", color: "var(--hue-home)", run: () => set({ palette: false, orion: "brief" }) });
      }
      // Course focus: "focus on machine learning", "leave focus".
      const fo = !o && t.match(/^(?:focus on|focus the app on|study|work on) (.+)$/i);
      if (fo) {
        const best = (ents?.courses ?? []).map((c) => ({ c, s: Math.max(fuzzy(fo[1], c.name), fuzzy(fo[1], c.code), courseMatch(fo[1], c) * 60) })).sort((a, b) => b.s - a.s)[0];
        if (best?.s > 0) items.push({ key: "cf", group: "Command", title: `Focus the app on ${best.c.name}`, sub: "Every world narrows to this course until you leave focus", icon: "target", color: best.c.color, run: () => { setFocusCourse({ id: best.c.id, name: best.c.name, color: best.c.color }); close(); toast(`Focused on ${best.c.name}.`, "good"); go("academy", { tab: "courses", id: best.c.id }); } });
      }
      if (!o && /^(?:leave|clear|exit|end|stop) (?:the )?(?:course )?focus$/i.test(t)) items.push({ key: "cl", group: "Command", title: "Leave course focus", icon: "x", run: () => { setFocusCourse(null); close(); toast("Course focus cleared.", "good"); } });
      const interp = o || items.length ? [] : interpret(t);
      for (const it of interp) { const item = toItem(it); if (item) items.push(item); }

      const openI = interp.find((i) => i.type === "open") as Extract<Interp, { type: "open" }> | undefined;
      const needle = openI?.text ?? t;
      const scored: [number, Item][] = [];
      const add = (score: number, item: Item) => { if (score > 0) scored.push([score, item]); };
      for (const c of ents?.courses ?? []) add(Math.max(fuzzy(needle, c.name), fuzzy(needle, c.code)) + (openI?.hint === "course" ? 60 : 0), { key: "c" + c.id, group: "Courses", title: c.name, sub: c.code || "Course", icon: "academy", color: c.color, run: () => go("academy", { tab: "courses", id: c.id }) });
      for (const p of ents?.projects ?? []) add(fuzzy(needle, p.name) + (openI?.hint === "project" ? 60 : 0), { key: "p" + p.id, group: "Projects", title: p.name, sub: "Project workspace", icon: "projects", color: p.color, run: () => go("projects", { id: p.id }) });
      for (const c of ents?.collections ?? []) add(fuzzy(needle, c.name), { key: "col" + c.id, group: "Collections", title: c.name, sub: "File collection", icon: "folder", color: "var(--hue-knowledge)", run: () => go("knowledge", { id: c.id }) });
      for (const p of ents?.prompts ?? []) add(fuzzy(t, p.title) - 20, { key: "pr" + p.id, group: "Prompts", title: p.title, sub: p.subject + " prompt", icon: "spark", color: "var(--hue-academy)", run: () => set({ palette: false, handoff: { fileIds: [], promptId: p.id } }) });
      for (const a of actions) add(fuzzy(t, a.title), a);
      scored.sort((a, b) => b[0] - a[0]);
      items.push(...scored.slice(0, 8).map((s) => s[1]));

      const fq = ftsQuery(needle);
      if (fq && interp[0]?.type !== "deadline" && interp[0]?.type !== "tx") {
        const [files, deadlines] = await Promise.all([
          q<any>("SELECT f.id, f.name, f.path, f.kind, f.parent, snippet(files_fts, 1, '‹', '›', '…', 10) snip FROM files_fts JOIN files f ON f.id = files_fts.rowid WHERE files_fts MATCH ? ORDER BY bm25(files_fts, 8.0, 1.0) LIMIT 7", [fq]).catch(() => []),
          q<any>("SELECT id, title, due_at, kind FROM deadlines WHERE title LIKE ? AND done = 0 ORDER BY due_at LIMIT 4", ["%" + needle + "%"]),
        ]);
        for (const f of files) items.push({ key: "f" + f.id, group: "Files", title: f.name, sub: f.snip?.includes("‹") ? f.snip.replace(/\s+/g, " ") : f.parent, icon: KIND_ICON[f.kind] ?? "file", color: `var(--hue-knowledge)`, run: () => go("knowledge", { action: "select", id: f.id }) });
        for (const d of deadlines) items.push({ key: "d" + d.id, group: "Deadlines", title: d.title, sub: `${d.kind} · ${fmtDate(d.due_at)} · ${relDay(d.due_at)}`, icon: "flag", color: "var(--hue-academy)", run: () => go("academy", { tab: "deadlines" }) });
        if (files.length >= 7) items.push({ key: "more", group: "Files", title: `See every file matching “${needle}”`, icon: "search", run: () => go("knowledge", { query: needle }) });
      }
      if (live) { setFound(items); setSel(0); }
      // A spoken command runs straight away when it was understood as a command; otherwise the
      // results stay on screen so nothing unexpected happens.
      if (live && auto.current === t && ents) { // wait until course and project names are loaded
        auto.current = null;
        const first = items[0];
        if (first && (first.group === "Command" || first.group === "ORION")) {
          const before = useUI.getState().toasts.at(-1)?.id ?? 0;
          await attempt(async () => first.run());
          const said = useUI.getState().toasts.at(-1);
          if (said && said.id !== before && said.kind !== "error" && first.group === "Command") void speak(said.text.replace(/[“”]/g, ""));
        } else void speak(items.length ? "Here is what I found." : "I heard: " + t + ". I am not sure what to do with that.");
      }
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, ents]);

  function toItem(i: Interp): Item | null {
    switch (i.type) {
      case "go": return { key: "go", group: "Command", title: `Go to ${i.label}`, icon: i.world, color: `var(--hue-${i.world})`, run: () => go(i.world, { tab: i.tab }) };
      case "deadline": return {
        key: "dl", group: "Command", icon: "flag", color: "var(--hue-academy)", title: `Add ${i.kind}: “${i.title}”`, sub: i.due ? `Due ${fmtDate(i.due, "long")} at ${i.due.slice(11)} · press Enter to save` : "No date recognised — Enter opens the form",
        run: async () => {
          if (!i.due) return set({ palette: false, quick: { type: "deadline", init: { title: i.title, kind: i.kind } } });
          const course = (ents?.courses ?? []).map((c) => ({ c, s: courseMatch(i.title, c) })).sort((a, b) => b.s - a.s)[0];
          const r = await run("INSERT INTO deadlines(title, kind, course_id, due_at, created_at) VALUES(?,?,?,?,?)", [i.title, i.kind, course?.s ? course.c.id : null, i.due, Date.now()]);
          void log("academy", "deadline", `Added ${i.kind}: ${i.title}`, { type: "deadline", id: r.lastId });
          close();
          toast(`Added “${i.title}” — due ${fmtDate(i.due)}${course?.s ? ` · ${course.c.name}` : ""}.`, "good", { label: "Edit", run: () => set({ quick: { type: "deadline", init: { id: r.lastId } } }) });
        },
      };
      case "tx": {
        const acct = ents?.accounts.find((a) => a.kind !== "liability" && a.kind !== "asset") ?? ents?.accounts[0];
        const cat = guessCategory(i.payee);
        return {
          key: "tx", group: "Command", icon: "wallet", color: "var(--hue-finance)", title: `${i.amount < 0 ? "Record expense" : "Record income"} ${acct ? money(Math.abs(i.amount), acct.currency) : Math.abs(i.amount)}${i.payee ? ` — ${i.payee}` : ""}`,
          sub: acct ? `${cat} · ${acct.name} · today · press Enter to save` : "Create an account first — Enter opens Finance",
          run: async () => {
            if (!acct) return go("finance", { tab: "accounts" });
            const r = await run("INSERT INTO transactions(account_id, date, amount, category, payee, created_at) VALUES(?,?,?,?,?,?)", [acct.id, today(), i.amount, cat, i.payee, Date.now()]);
            void log("finance", "tx", `${i.amount < 0 ? "Spent" : "Received"} ${money(Math.abs(i.amount), acct.currency)}`, { type: "tx", id: r.lastId }, i.payee);
            close();
            toast(`Saved ${money(i.amount, acct.currency)} · ${cat} · ${acct.name}.`, "good", { label: "Edit", run: () => set({ quick: { type: "tx", init: { id: r.lastId } } }) });
          },
        };
      }
      case "project": return { key: "np", group: "Command", icon: "projects", color: "var(--hue-projects)", title: i.name ? `Create project “${i.name}”` : "Create a new project", run: () => set({ palette: false, quick: { type: "project", init: { name: i.name } } }) };
      case "task": {
        const p = (ents?.projects ?? []).map((p) => ({ p, s: fuzzy(i.project, p.name) })).sort((a, b) => b.s - a.s)[0];
        const target = i.project && p?.s ? p.p : ents?.projects[0];
        return { key: "nt", group: "Command", icon: "check", color: "var(--hue-projects)", title: `Add task “${i.title}”`, sub: target ? `In ${target.name}` : "Create a project first", run: async () => {
          if (!target) return set({ palette: false, quick: { type: "project" } });
          await run("INSERT INTO tasks(project_id, title, sort, created_at) VALUES(?,?,?,?)", [target.id, i.title, Date.now(), Date.now()]);
          close(); toast(`Task added to ${target.name}.`, "good", { label: "Open", run: () => go("projects", { id: target.id }) });
        } };
      }
      case "capture": return { key: "cap", group: "Command", icon: "note", title: `Capture: “${i.text}”`, sub: "Saved to your capture inbox", run: () => { close(); return capture(i.text, "command bar"); } };
      case "search": return { key: "s", group: "Command", icon: "search", color: "var(--hue-knowledge)", title: `Search ${i.ext ? i.ext.toUpperCase() + " files" : i.kind ? i.kind + " files" : "all files"} for “${i.text}”`, sub: "Full-text search inside your indexed documents", run: () => go("knowledge", { query: i.text, payload: { kind: i.kind, ext: i.ext } }) };
      case "recent": return { key: "r", group: "Command", icon: "clock", color: "var(--hue-knowledge)", title: `Files modified in the last ${i.days} days`, run: () => go("knowledge", { payload: { recentDays: i.days } }) };
      case "due": return { key: "due", group: "Command", icon: "calendar", color: "var(--hue-academy)", title: `Show ${i.kind ? i.kind + "s" : "everything"} due ${i.range === "today" ? "today" : "this " + i.range}`, run: () => go("academy", { tab: "deadlines", payload: { range: i.range, kind: i.kind } }) };
      default: return null;
    }
  }

  const items = text.trim() ? found : actions;
  useEffect(() => { listRef.current?.querySelector(".pal-item.on")?.scrollIntoView({ block: "nearest" }); }, [sel]);

  let lastGroup = "";
  return (
    <div className="scrim" style={{ placeItems: "start center" }} onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-label="Command bar">
        <div style={{ position: "relative" }}>
          <Icon name="search" size={19} style={{ position: "absolute", left: 20, top: 20, color: "var(--hue)" }} />
          <input autoFocus value={text} placeholder="Search files, open a course, “quiz ML friday 3pm”, “spent 450 on lunch”…" spellCheck={false}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(items.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter" && items[sel]) { e.preventDefault(); void attempt(async () => items[sel].run()); }
              else if (e.key === "Escape") close();
            }} />
        </div>
        <div className="results" ref={listRef}>
          {items.length === 0 && <div className="faint small" style={{ padding: "22px 14px" }}>{text.trim() === query.trim() ? "Nothing matches. Try a file name, a word inside a document, or a command like “add exam Signals 12 dec”." : "Searching…"}</div>}
          {items.map((it, i) => {
            const head = it.group !== lastGroup ? <div className="label group" key={"g" + it.group + i}>{it.group}</div> : null;
            lastGroup = it.group;
            return [head, (
              <div key={it.key} className={"pal-item" + (i === sel ? " on" : "")} onMouseMove={() => sel !== i && setSel(i)} onClick={() => void attempt(async () => it.run())}>
                <span className="ico" style={{ "--c": it.color } as any}><Icon name={it.icon} size={15} /></span>
                <div className="col grow" style={{ gap: 1 }}><span className="truncate">{it.title}</span>{it.sub && <span className="small faint truncate">{it.sub}</span>}</div>
                {it.hint && <span className="kbd">{it.hint}</span>}
              </div>
            )];
          })}
        </div>
        <div className="pal-foot"><span><span className="kbd">↑↓</span> move</span><span><span className="kbd">Enter</span> run</span><span><span className="kbd">Esc</span> close</span><span style={{ marginLeft: "auto" }}>Everything here runs locally</span></div>
      </div>
    </div>
  );
}
