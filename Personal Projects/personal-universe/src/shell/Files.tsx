// Shared file pieces: the inspector (preview + metadata + relationships) and the
// "linked files" panel used by courses and projects.
import { useEffect, useMemo, useState } from "react";
import { call, fileUrl, isTauri, native, q, run } from "../lib/backend";
import { link, openFile, unlink } from "../lib/actions";
import { ago, fmtDate } from "../lib/dates";
import { bytes, ftsQuery, KIND_LABEL, PALETTE } from "../lib/format";
import { useDebounced, useQ, useRows } from "../lib/hooks";
import { attempt, useUI } from "../lib/store";
import { Icon, KIND_ICON } from "../ui/Icons";
import { Check, Empty, Menu, MenuItem, Modal } from "../ui/kit";

export interface FileRow { id: number; collection_id: number; path: string; parent: string; name: string; ext: string; kind: string; size: number; mtime: number; imported_at: number; opened_at: number | null; hash: string | null; text_len: number; excerpt: string; meta: string; missing: number; favourite: number; inbox_state: string | null; snip?: string }

export function highlight(text: string, needle: string) {
  const words = needle.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1);
  if (!words.length) return text;
  const re = new RegExp(`(${words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "gi");
  return text.split(re).map((part, i) => (i % 2 ? <mark key={i}>{part}</mark> : part));
}
/** Renders an FTS snippet whose matches are wrapped in ‹ ›. */
export function Snip({ text }: { text: string }) {
  return <>{text.split(/[‹›]/).map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}</>;
}

export function Preview({ file, needle = "", tall }: { file: FileRow; needle?: string; tall?: boolean }) {
  const text = useQ(() => (file.text_len > 0 ? call<{ text: string; truncated: boolean }>("files.text", { id: file.id, max: 24000 }) : Promise.resolve(null)), [file.id]).data;
  const h = tall ? "min(56vh, 620px)" : 230;
  if (file.missing) return <div className="empty" style={{ height: 160, padding: 16 }}><Icon name="warn" size={22} /><span className="small">The original is no longer at this location.</span></div>;
  if (file.kind === "image") return <div style={{ height: h, display: "grid", placeItems: "center", background: "var(--plate)", borderRadius: 14, overflow: "hidden" }}><img src={fileUrl(file.path, !tall)} alt={file.name} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div>;
  if (file.kind === "audio") return <audio controls src={fileUrl(file.path)} style={{ width: "100%" }} />;
  if (file.kind === "video" && /^(mp4|webm|m4v)$/.test(file.ext) && file.size < 280 * 1024 * 1024) return <video controls src={fileUrl(file.path)} style={{ width: "100%", maxHeight: h, borderRadius: 14, background: "#000" }} />;
  if (text?.text) return (
    <div className="scroll selectable plate" style={{ height: h, padding: "14px 16px", fontSize: 12, lineHeight: 1.6, whiteSpace: "pre-wrap", wordBreak: "break-word", fontFamily: file.kind === "code" || file.kind === "data" || file.kind === "eng" ? "var(--font-mono)" : "var(--font-ui)", color: "var(--ink-2)", borderRadius: 14 }}>
      {highlight(text.text, needle)}{text.truncated && <div className="faint" style={{ marginTop: 12 }}>— preview ends here; open the file to read on —</div>}
    </div>
  );
  return <div className={"empty kind-" + file.kind} style={{ height: 160, padding: 16, background: "var(--plate)", borderRadius: 14 }}><Icon name={KIND_ICON[file.kind]} size={30} stroke={1.1} style={{ color: "var(--c)" }} /><span className="small">{file.text_len ? "" : "No text preview for this file type."}</span></div>;
}

export function Inspector({ id, needle, onClose, onSearch }: { id: number; needle?: string; onClose: () => void; onSearch?: (t: string) => void }) {
  const set = useUI((s) => s.set);
  const go = useUI((s) => s.go);
  const file = useRows<FileRow>("SELECT * FROM files WHERE id = ?", [id])[0];
  const terms = useRows<{ term: string }>("SELECT term FROM file_terms WHERE file_id = ? ORDER BY weight DESC LIMIT 10", [id]);
  const tags = useRows<any>("SELECT t.* FROM tags t JOIN file_tags ft ON ft.tag_id = t.id WHERE ft.file_id = ?", [id]);
  const allTags = useRows<any>("SELECT * FROM tags ORDER BY name");
  const links = useRows<any>(`SELECT l.b_type type, l.b_id id, COALESCE(c.name, p.name) name, COALESCE(c.color, p.color) color FROM links l LEFT JOIN courses c ON l.b_type = 'course' AND c.id = l.b_id LEFT JOIN projects p ON l.b_type = 'project' AND p.id = l.b_id WHERE l.a_type = 'file' AND l.a_id = ?`, [id]);
  const courses = useRows<any>("SELECT id, name, code, color FROM courses WHERE archived = 0 ORDER BY name");
  const projects = useRows<any>("SELECT id, name, color FROM projects ORDER BY name");
  // Related = other files that share this file's most characteristic terms.
  const related = useRows<any>("SELECT f.id, f.name, f.kind, COUNT(*) shared, GROUP_CONCAT(b.term, ', ') terms FROM file_terms a JOIN file_terms b ON b.term = a.term AND b.file_id != a.file_id JOIN files f ON f.id = b.file_id WHERE a.file_id = ? GROUP BY f.id HAVING shared >= 2 ORDER BY shared DESC, SUM(a.weight * b.weight) DESC LIMIT 5", [id]);
  const dupes = useRows<any>("SELECT id, path FROM files WHERE hash = ? AND id != ? AND hash IS NOT NULL LIMIT 4", [file?.hash ?? "", id], !!file?.hash);
  const [tagText, setTagText] = useState("");

  // Categorisation suggestion: a course or project whose name words appear in this file's name, path or key terms.
  const suggestion = useMemo(() => {
    if (!file) return null;
    const hay = (file.path + " " + terms.map((t) => t.term).join(" ")).toLowerCase();
    const linked = new Set(links.map((l) => l.type + l.id));
    const score = (name: string, code?: string) => { const words = name.toLowerCase().split(/\W+/).filter((w) => w.length >= 4); const hits = words.filter((w) => hay.includes(w)); if (code && hay.includes(code.toLowerCase())) hits.push(code); return hits.length >= Math.min(2, words.length) && hits.length > 0 ? hits : null; };
    for (const c of courses) { const hits = !linked.has("course" + c.id) && score(c.name, c.code); if (hits) return { type: "course", id: c.id, name: c.name, hits }; }
    for (const p of projects) { const hits = !linked.has("project" + p.id) && score(p.name); if (hits) return { type: "project", id: p.id, name: p.name, hits }; }
    return null;
  }, [file, terms, links, courses, projects]);

  if (!file) return null;
  const meta = (() => { try { return JSON.parse(file.meta); } catch { return {}; } })();
  const addTag = async (name: string) => {
    const n = name.trim().toLowerCase();
    if (!n) return;
    await call("db.exec", { sql: "INSERT OR IGNORE INTO tags(name, color) VALUES(?, ?)", params: [n, PALETTE[n.length % PALETTE.length]] });
    await run("INSERT OR IGNORE INTO file_tags(file_id, tag_id) SELECT ?, id FROM tags WHERE name = ?", [id, n]);
    setTagText("");
  };
  return (
    <aside className={"col kind-" + file.kind} style={{ width: 340, flex: "none", borderLeft: "1px solid var(--line)", minHeight: 0 }}>
      <div className="row between" style={{ padding: "14px 16px 8px" }}>
        <span className="chip tint"><Icon name={KIND_ICON[file.kind]} size={12} />{KIND_LABEL[file.kind]}{file.ext ? ` · ${file.ext}` : ""}</span>
        <div className="row gap1">
          <button className={"icon-btn sm" + (file.favourite ? " on" : "")} title="Favourite" onClick={() => run("UPDATE files SET favourite = 1 - favourite WHERE id = ?", [id])}><Icon name="star" size={15} /></button>
          <button className="icon-btn sm" onClick={onClose} aria-label="Close inspector"><Icon name="x" size={15} /></button>
        </div>
      </div>
      <div className="scroll col gap4 noshrink" style={{ padding: "4px 16px calc(var(--dock-h) + 24px)" }}>
        <h3 className="title selectable" style={{ wordBreak: "break-word", fontSize: 17 }}>{file.name}</h3>
        <Preview file={file} needle={needle} />
        <div className="row wrap gap1">
          <button className="btn sm primary" onClick={() => openFile(file)} disabled={!isTauri || !!file.missing} title={isTauri ? "" : "Available in the desktop app"}><Icon name="external" size={13} />Open</button>
          <button className="btn sm" onClick={() => attempt(() => native.reveal(file.path))} disabled={!isTauri || !!file.missing}><Icon name="folder" size={13} />Show in Explorer</button>
          <button className="btn sm" onClick={() => set({ handoff: { fileIds: [id] } })}><Icon name="send" size={13} />Hand off</button>
        </div>

        {suggestion && <div className="plate" style={{ padding: 12, borderStyle: "dashed" }}>
          <div className="row between gap3"><div className="col" style={{ gap: 1 }}><span className="small">Suggested: link to <b>{suggestion.name}</b></span><span className="faint" style={{ fontSize: 11 }}>because it mentions {suggestion.hits.map((h: string) => `“${h}”`).join(", ")}</span></div><button className="btn sm" onClick={() => link("file", id, suggestion.type, suggestion.id)}>Link</button></div>
        </div>}

        <div className="col gap1">
          <span className="label">Connections</span>
          <div className="row wrap gap1">
            {links.map((l) => <span key={l.type + l.id} className="chip tint" style={{ "--c": l.color } as any}><button className="row gap1" onClick={() => (l.type === "course" ? go("academy", { tab: "courses", id: l.id }) : go("projects", { id: l.id }))}><Icon name={l.type === "course" ? "academy" : "projects"} size={11} />{l.name}</button><button onClick={() => unlink("file", id, l.type, l.id)} aria-label="Unlink"><Icon name="x" size={10} /></button></span>)}
            <Menu align="left" button={<button className="chip"><Icon name="link" size={11} />Connect…</button>}>{(close) => <div className="scroll" style={{ maxHeight: 260 }}>
              {courses.length + projects.length === 0 && <div className="small faint" style={{ padding: 8 }}>Create a course or project first.</div>}
              {courses.map((c) => <MenuItem key={"c" + c.id} icon="academy" onClick={() => { void link("file", id, "course", c.id); close(); }}>{c.name}</MenuItem>)}
              {projects.map((p) => <MenuItem key={"p" + p.id} icon="projects" onClick={() => { void link("file", id, "project", p.id); close(); }}>{p.name}</MenuItem>)}
            </div>}</Menu>
          </div>
        </div>

        <div className="col gap1">
          <span className="label">Tags</span>
          <div className="row wrap gap1">
            {tags.map((t) => <span key={t.id} className="chip tint" style={{ "--c": t.color } as any}>#{t.name}<button onClick={() => run("DELETE FROM file_tags WHERE file_id = ? AND tag_id = ?", [id, t.id])} aria-label="Remove tag"><Icon name="x" size={10} /></button></span>)}
            <input className="input bare small" style={{ width: 110 }} list="pu-tags" value={tagText} onChange={(e) => setTagText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag(tagText)} placeholder="+ add tag" />
            <datalist id="pu-tags">{allTags.map((t) => <option key={t.id} value={t.name} />)}</datalist>
          </div>
        </div>

        {terms.length > 0 && <div className="col gap1"><span className="label" title="The most frequent distinctive words found in this file's text">Key terms</span><div className="row wrap gap1">{terms.map((t) => <button key={t.term} className="chip" onClick={() => onSearch?.(t.term)}>{t.term}</button>)}</div></div>}

        {related.length > 0 && <div className="col gap1"><span className="label">Related by shared terms</span>{related.map((r) => (
          <button key={r.id} className={"list-row small kind-" + r.kind} style={{ textAlign: "left", padding: "6px 8px", margin: "0 -8px" }} onClick={() => go("knowledge", { action: "select", id: r.id })} title={`Shares: ${r.terms}`}>
            <Icon name={KIND_ICON[r.kind]} size={14} style={{ color: "var(--c)", flex: "none" }} /><span className="grow truncate">{r.name}</span><span className="faint">{r.shared} terms</span>
          </button>
        ))}</div>}
        {dupes.length > 0 && <div className="col gap1"><span className="label warn">Identical copies</span>{dupes.map((d) => <span key={d.id} className="small faint selectable" style={{ wordBreak: "break-all" }}>{d.path}</span>)}</div>}

        <div className="col gap1 small">
          <span className="label">Details</span>
          {[["Size", bytes(file.size)], ["Modified", fmtDate(new Date(file.mtime), "long")], ["Added", ago(file.imported_at)], file.opened_at ? ["Opened", ago(file.opened_at)] : null, meta.width ? ["Dimensions", `${meta.width} × ${meta.height}`] : null, meta.slides ? ["Slides", meta.slides] : null, meta.sheets ? ["Sheets", meta.sheets.join(", ")] : null, file.text_len ? ["Indexed text", `${file.text_len.toLocaleString()} characters`] : ["Indexed text", "none (name and metadata only)"]].filter(Boolean).map((r: any) => <div key={r[0]} className="row between gap3"><span className="faint">{r[0]}</span><span className="truncate">{r[1]}</span></div>)}
          <span className="faint selectable mono" style={{ wordBreak: "break-all", fontSize: 10.5, marginTop: 4 }}>{file.path}</span>
        </div>
      </div>
    </aside>
  );
}

/** Pick indexed files by name or content. */
export function FilePicker({ title, onPick, onClose }: { title: string; onPick: (ids: number[]) => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [sel, setSel] = useState<Set<number>>(new Set());
  const query = useDebounced(text, 150);
  const fq = ftsQuery(query);
  const rows = useQ<any[]>(() => (fq ? q("SELECT f.id, f.name, f.kind, f.parent FROM files_fts JOIN files f ON f.id = files_fts.rowid WHERE files_fts MATCH ? ORDER BY bm25(files_fts, 8.0, 1.0) LIMIT 40", [fq]) : q("SELECT id, name, kind, parent FROM files WHERE missing = 0 ORDER BY imported_at DESC, id DESC LIMIT 40")), [fq]).data ?? [];
  const toggle = (id: number) => { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); };
  return (
    <Modal title={title} sub="Search by name or by words inside the document." onClose={onClose} foot={<><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" disabled={!sel.size} onClick={() => { onPick([...sel]); onClose(); }}>Add {sel.size || ""}</button></>}>
      <input className="input" autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder="Search your library…" />
      <div className="scroll" style={{ height: 320, margin: "0 -8px" }}>
        {rows.length === 0 && <Empty icon="search" title="No files found">Import a folder in Knowledge, then link its files here.</Empty>}
        {rows.map((f) => <div key={f.id} className={"list-row small kind-" + f.kind + (sel.has(f.id) ? " on" : "")} onClick={() => toggle(f.id)}><Check on={sel.has(f.id)} onChange={() => toggle(f.id)} /><Icon name={KIND_ICON[f.kind]} size={15} style={{ color: "var(--c)", flex: "none" }} /><div className="col grow" style={{ gap: 0 }}><span className="truncate">{f.name}</span><span className="faint truncate" style={{ fontSize: 10.5 }}>{f.parent}</span></div></div>)}
      </div>
    </Modal>
  );
}

/** Files connected to a course or project, with selection for AI handoff. */
export function LinkedFiles({ type, id }: { type: "course" | "project"; id: number }) {
  const set = useUI((s) => s.set);
  const go = useUI((s) => s.go);
  const rows = useRows<FileRow>("SELECT f.* FROM links l JOIN files f ON f.id = l.a_id WHERE l.a_type = 'file' AND l.b_type = ? AND l.b_id = ? ORDER BY f.kind, f.name", [type, id]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [picking, setPicking] = useState(false);
  useEffect(() => setSel(new Set()), [id]);
  const toggle = (fid: number) => { const n = new Set(sel); n.has(fid) ? n.delete(fid) : n.add(fid); setSel(n); };
  return (
    <div className="col gap3">
      <div className="row between">
        <span className="label">Materials · {rows.length}</span>
        <div className="row gap1">
          {sel.size > 0 && <button className="btn sm primary" onClick={() => set({ handoff: { fileIds: [...sel] } })}><Icon name="send" size={13} />Study {sel.size} with an assistant</button>}
          <button className="btn sm" onClick={() => setPicking(true)}><Icon name="link" size={13} />Link files</button>
        </div>
      </div>
      {rows.length === 0 ? <p className="small faint">Nothing linked yet. Link lecture notes, slides, lab files or code from your library — the originals stay where they are.</p> : (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(230px, 1fr))", gap: 6 }}>
          {rows.map((f) => (
            <div key={f.id} className={"list-row small plate kind-" + f.kind + (sel.has(f.id) ? " on" : "")} style={{ borderRadius: 11 }} onDoubleClick={() => openFile(f)}>
              <Check on={sel.has(f.id)} onChange={() => toggle(f.id)} label="Select for handoff" />
              <Icon name={KIND_ICON[f.kind]} size={15} style={{ color: "var(--c)", flex: "none" }} />
              <button className="grow truncate" style={{ textAlign: "left" }} onClick={() => go("knowledge", { action: "select", id: f.id })} title={f.path}>{f.name}</button>
              {f.missing ? <span className="bad">missing</span> : null}
              <button className="icon-btn sm reveal" aria-label="Unlink" onClick={() => unlink("file", f.id, type, id)}><Icon name="x" size={12} /></button>
            </div>
          ))}
        </div>
      )}
      {picking && <FilePicker title="Link files" onClose={() => setPicking(false)} onPick={async (ids) => { for (const fid of ids) await link("file", fid, type, id); }} />}
    </div>
  );
}
