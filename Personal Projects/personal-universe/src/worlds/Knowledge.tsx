// Knowledge — one library, many ways of seeing it. The scope (what) and the view (how)
// are independent, so switching views never loses your place.
import { useEffect, useMemo, useRef, useState } from "react";
import { fileUrl, isTauri, native, q, run, batch, call } from "../lib/backend";
import { link, openFile, pickAndImport, rescan } from "../lib/actions";
import { MONTHS, ago, fmtDate } from "../lib/dates";
import { bytes, ftsQuery, KIND_COLOR, KIND_LABEL, PALETTE, plural } from "../lib/format";
import { useCourseFocus, useDebounced, useIntent, useQ, useRows, useSetting } from "../lib/hooks";
import { attempt, toast, useUI } from "../lib/store";
import { Icon, KIND_ICON } from "../ui/Icons";
import { Check, Confirm, Empty, Menu, MenuItem, Seg } from "../ui/kit";
import { FileRow, Inspector, Preview, Snip } from "../shell/Files";
import { GraphView, SpatialView } from "./KnowledgeViews";

type Scope = { t: "all" } | { t: "collection"; id: number } | { t: "inbox" } | { t: "fav" } | { t: "recent"; days: number } | { t: "dups" } | { t: "missing" } | { t: "tag"; id: number } | { t: "course"; id: number };
type View = "spatial" | "gallery" | "tree" | "graph" | "timeline";
const VIEWS: { value: View; label: string; icon: string }[] = [{ value: "spatial", label: "Map", icon: "orbit" }, { value: "gallery", label: "Gallery", icon: "grid" }, { value: "tree", label: "Folders", icon: "tree" }, { value: "graph", label: "Graph", icon: "knowledge" }, { value: "timeline", label: "Timeline", icon: "timeline" }];
const SORTS: Record<string, string> = { relevance: "bm25(files_fts, 8.0, 1.0)", modified: "f.mtime DESC", name: "f.name COLLATE NOCASE", size: "f.size DESC", added: "f.imported_at DESC, f.id DESC" };

export default function Knowledge() {
  const set = useUI((s) => s.set);
  const [scope, setScope] = useState<Scope>({ t: "all" });
  const [view, setView] = useSetting<View>("knowledge.view", "spatial");
  const [text, setText] = useState("");
  const [kind, setKind] = useState<string | null>(null);
  const [ext, setExt] = useState<string | null>(null);
  const [sort, setSort] = useState("modified");
  const [focus, setFocus] = useState<number | null>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [limit, setLimit] = useState(120);
  const search = useDebounced(text, 160);
  const [courseFocus] = useCourseFocus();
  // Entering or leaving course focus moves the library to that course's linked files and back.
  useEffect(() => { setScope(courseFocus ? { t: "course", id: courseFocus.id } : (sc) => (sc.t === "course" ? { t: "all" } : sc)); }, [courseFocus?.id]);

  useIntent("knowledge", (i) => {
    if (i.action === "import") void pickAndImport("folder");
    if (i.action === "select" && i.id) { setFocus(i.id); return; }
    if (i.id) setScope({ t: "collection", id: i.id });
    else if (i.tab === "inbox") setScope({ t: "inbox" });
    else if (i.tab === "duplicates") setScope({ t: "dups" });
    else if (i.tab === "missing") setScope({ t: "missing" });
    else if (i.payload?.recentDays) { setScope({ t: "recent", days: i.payload.recentDays }); setView("gallery"); }
    if (i.query != null) { setScope({ t: "all" }); setText(i.query); setKind(i.payload?.kind ?? null); setExt(i.payload?.ext ?? null); setView("gallery"); }
  });

  const collections = useRows<any>("SELECT c.*, (SELECT COUNT(*) FROM files f WHERE f.collection_id = c.id) n FROM collections c ORDER BY c.kind != 'folder', c.pinned DESC, c.name COLLATE NOCASE");
  const counts = useRows<any>("SELECT (SELECT COUNT(*) FROM files) total, (SELECT COUNT(*) FROM files WHERE inbox_state = 'new') inbox, (SELECT COUNT(*) FROM files WHERE favourite = 1) fav, (SELECT COUNT(*) FROM files WHERE missing = 1) missing, (SELECT COUNT(*) FROM (SELECT 1 FROM files WHERE hash IS NOT NULL AND missing = 0 GROUP BY hash HAVING COUNT(*) > 1)) dups")[0] ?? {};
  const tags = useRows<any>("SELECT t.*, COUNT(ft.file_id) n FROM tags t LEFT JOIN file_tags ft ON ft.tag_id = t.id GROUP BY t.id ORDER BY t.name");

  // One WHERE clause shared by every view.
  const fq = ftsQuery(search);
  const base = useMemo(() => {
    const conds: string[] = [], params: (string | number)[] = [];
    if (fq) { conds.push("files_fts MATCH ?"); params.push(fq); }
    if (scope.t === "collection") { conds.push("f.collection_id = ?"); params.push(scope.id); }
    else if (scope.t === "inbox") conds.push("f.inbox_state = 'new'");
    else if (scope.t === "fav") conds.push("f.favourite = 1");
    else if (scope.t === "missing") conds.push("f.missing = 1");
    else if (scope.t === "recent") { conds.push("f.mtime >= ?"); params.push(Date.now() - scope.days * 86400000); }
    else if (scope.t === "course") { conds.push("f.id IN (SELECT a_id FROM links WHERE a_type = 'file' AND b_type = 'course' AND b_id = ?)"); params.push(scope.id); }
    else if (scope.t === "tag") { conds.push("f.id IN (SELECT file_id FROM file_tags WHERE tag_id = ?)"); params.push(scope.id); }
    if (ext) { conds.push("f.ext = ?"); params.push(ext); }
    const mk = (c: string[], p: (string | number)[]) => ({ from: `FROM files f ${fq ? "JOIN files_fts ON files_fts.rowid = f.id" : ""} WHERE ${c.length ? c.join(" AND ") : "1"}`, params: p });
    return { ...mk(kind ? [...conds, "f.kind = ?"] : conds, kind ? [...params, kind] : params), noKind: mk(conds, params) };
  }, [fq, scope, kind, ext]);
  const baseKey = base.from + JSON.stringify(base.params);
  useEffect(() => { setLimit(120); if (fq && sort !== "relevance") setSort("relevance"); if (!fq && sort === "relevance") setSort("modified"); /* eslint-disable-next-line */ }, [baseKey]);

  const order = SORTS[fq ? sort : sort === "relevance" ? "modified" : sort];
  const files = useQ<FileRow[]>(() => q(`SELECT f.*${fq ? ", snippet(files_fts, 1, '‹', '›', '…', 14) snip" : ""} ${base.from} ORDER BY ${order} LIMIT ?`, [...base.params, limit]), [baseKey, order, limit]).data ?? [];
  const stats = useQ<any[]>(() => q(`SELECT f.kind, COUNT(*) n, SUM(f.size) size ${base.noKind.from} GROUP BY f.kind ORDER BY n DESC`, base.noKind.params), [baseKey]).data ?? [];
  const total = stats.reduce((n, s) => n + s.n, 0);
  const shown = kind ? stats.find((s) => s.kind === kind)?.n ?? 0 : total;

  const pick = (id: number, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => {
    if (e && (e.ctrlKey || e.metaKey)) { const n = new Set(sel); n.has(id) ? n.delete(id) : n.add(id); setSel(n); } else setFocus(id);
  };
  const open = (id: number) => { const f = files.find((x) => x.id === id); if (f) void openFile(f); else q<FileRow>("SELECT * FROM files WHERE id = ?", [id]).then((r) => r[0] && openFile(r[0])); };
  const scopeName = scope.t === "all" ? "Everything" : scope.t === "collection" ? collections.find((c) => c.id === scope.id)?.name ?? "Collection" : scope.t === "inbox" ? "Inbox" : scope.t === "fav" ? "Favourites" : scope.t === "recent" ? `Modified in the last ${scope.days} days` : scope.t === "dups" ? "Duplicates" : scope.t === "missing" ? "Missing files" : scope.t === "course" ? `${courseFocus?.name ?? "Course"} — linked files` : "#" + (tags.find((t) => t.id === scope.id)?.name ?? "tag");

  if (collections.length === 0) return (
    <div className="world-body" style={{ display: "grid", placeItems: "center" }}>
      <div className="col gap4" style={{ alignItems: "center", textAlign: "center", maxWidth: 620 }}>
        <div className="empty" style={{ padding: 0 }}><div className="glyph" style={{ width: 96, height: 96 }}><Icon name="knowledge" size={40} stroke={1} /></div></div>
        <h1 className="display" style={{ fontSize: 52 }}>Drop a folder anywhere.</h1>
        <p className="lead dim">Personal Universe reads it where it lives — text, documents, slides, spreadsheets, code — and turns it into a map you can search and explore. Your files are never moved, copied or changed.</p>
        <div className="row"><button className="btn primary" onClick={() => pickAndImport("folder")}><Icon name="folder" size={15} />Choose a folder</button><button className="btn" onClick={() => pickAndImport("files")}><Icon name="upload" size={15} />Choose files</button><button className="btn" onClick={() => pickAndImport("folder", { watched: true })}><Icon name="eye" size={15} />Watch a folder</button></div>
        <p className="small faint">Watched folders are re-checked when the app starts and every ten minutes while it is open.</p>
      </div>
    </div>
  );

  return (
    <div className="world-body flush" style={{ flexDirection: "row" }}>
      {/* Library rail */}
      <nav className="col scroll" style={{ width: 228, flex: "none", padding: "16px 10px calc(var(--dock-h) + 20px) 18px", gap: 2 }}>
        <RailItem icon="orbit" label="Everything" count={counts.total} on={scope.t === "all"} onClick={() => setScope({ t: "all" })} />
        {courseFocus && <RailItem icon="target" label={courseFocus.name} on={scope.t === "course"} onClick={() => setScope({ t: "course", id: courseFocus.id })} />}
        <RailItem icon="inbox" label="Inbox" count={counts.inbox} on={scope.t === "inbox"} onClick={() => setScope({ t: "inbox" })} accent />
        <RailItem icon="star" label="Favourites" count={counts.fav} on={scope.t === "fav"} onClick={() => setScope({ t: "fav" })} />
        <RailItem icon="clock" label="Recent" on={scope.t === "recent"} onClick={() => { setScope({ t: "recent", days: 7 }); }} />
        {counts.dups > 0 && <RailItem icon="duplicate" label="Duplicates" count={counts.dups} on={scope.t === "dups"} onClick={() => setScope({ t: "dups" })} />}
        {counts.missing > 0 && <RailItem icon="warn" label="Missing" count={counts.missing} on={scope.t === "missing"} onClick={() => setScope({ t: "missing" })} />}
        <div className="row between" style={{ margin: "18px 8px 6px" }}><span className="label">Collections</span>
          <Menu button={<button className="icon-btn sm" aria-label="Add to library"><Icon name="plus" size={14} /></button>}>{(close) => <>
            <MenuItem icon="folder" onClick={() => { close(); void pickAndImport("folder"); }}>Import a folder</MenuItem>
            <MenuItem icon="eye" onClick={() => { close(); void pickAndImport("folder", { watched: true }); }}>Watch a folder</MenuItem>
            <MenuItem icon="upload" onClick={() => { close(); void pickAndImport("files"); }}>Import files</MenuItem>
            <MenuItem icon="inbox" onClick={() => { close(); void pickAndImport("files", { inbox: true }); }}>Add files to Inbox</MenuItem>
          </>}</Menu>
        </div>
        {collections.filter((c) => c.kind !== "inbox").map((c) => (
          <div key={c.id} className={"list-row small" + (scope.t === "collection" && scope.id === c.id ? " on" : "")} style={{ padding: "7px 8px", cursor: "pointer" }} onClick={() => setScope({ t: "collection", id: c.id })} title={c.root_path.startsWith("::") ? "Individually imported files" : c.root_path}>
            <Icon name={c.pinned ? "star" : c.kind === "folder" ? "folder" : "file"} size={15} style={{ color: scope.t === "collection" && scope.id === c.id ? "var(--hue)" : "var(--ink-3)", flex: "none" }} />
            <span className="grow truncate">{c.name}</span>
            {c.watched ? <Icon name="eye" size={11} style={{ color: "var(--ink-4)" }} /> : null}
            <span className="faint num" style={{ fontSize: 10.5 }}>{c.n}</span>
            <Menu button={<button className="icon-btn sm reveal" style={{ width: 20, height: 20 }} aria-label="Collection options" onClick={(e) => e.stopPropagation()}><Icon name="more" size={13} /></button>}>{(close) => <div onClick={(e) => e.stopPropagation()}>
              <MenuItem icon="repeat" onClick={() => { close(); void rescan(c.id); }}>Rescan now</MenuItem>
              {c.kind === "folder" && <MenuItem icon="eye" onClick={() => { close(); void run("UPDATE collections SET watched = 1 - watched WHERE id = ?", [c.id]); }}>{c.watched ? "Stop watching" : "Watch for changes"}</MenuItem>}
              <MenuItem icon="star" onClick={() => { close(); void run("UPDATE collections SET pinned = 1 - pinned WHERE id = ?", [c.id]); }}>{c.pinned ? "Unpin" : "Pin to Home"}</MenuItem>
              {c.kind === "folder" && isTauri && <MenuItem icon="external" onClick={() => { close(); void attempt(() => native.openPath(c.root_path)); }}>Open in Explorer</MenuItem>}
              <Confirm className="btn sm ghost danger" label="Remove from library" onConfirm={() => attempt(async () => { await run("DELETE FROM collections WHERE id = ?", [c.id]); setScope({ t: "all" }); close(); }, `“${c.name}” was removed from the index. The files themselves were not touched.`)} />
            </div>}</Menu>
          </div>
        ))}
        {tags.length > 0 && <><span className="label" style={{ margin: "18px 8px 6px" }}>Tags</span>
          <div className="row wrap gap1" style={{ padding: "0 6px" }}>{tags.map((t) => <button key={t.id} className={"chip tint" + (scope.t === "tag" && scope.id === t.id ? " on" : "")} style={{ "--c": t.color } as any} onClick={() => setScope({ t: "tag", id: t.id })}>#{t.name}<span className="faint">{t.n}</span></button>)}</div></>}
      </nav>

      {/* Main */}
      <div className="col grow" style={{ minHeight: 0, gap: 0, borderLeft: "1px solid var(--line)" }}>
        <div className="row gap3" style={{ padding: "12px 18px", borderBottom: "1px solid var(--line)", flex: "none" }}>
          <div className="col" style={{ gap: 0, minWidth: 120 }}><h1 className="display truncate" style={{ fontSize: 26 }}>{scopeName}</h1><span className="faint" style={{ fontSize: 11 }}>{plural(shown, "file")}{stats.length ? ` · ${bytes(stats.filter((s) => !kind || s.kind === kind).reduce((n, s) => n + s.size, 0))}` : ""}</span></div>
          <div style={{ position: "relative", flex: 1, maxWidth: 380, marginLeft: 8 }}>
            <Icon name="search" size={14} style={{ position: "absolute", left: 11, top: 10, color: "var(--ink-3)" }} />
            <input className="input" style={{ paddingLeft: 32 }} value={text} onChange={(e) => setText(e.target.value)} placeholder="Search names and contents…" spellCheck={false} />
            {text && <button className="icon-btn sm" style={{ position: "absolute", right: 4, top: 4 }} onClick={() => { setText(""); setExt(null); }} aria-label="Clear search"><Icon name="x" size={12} /></button>}
          </div>
          <span className="grow" />
          {scope.t !== "dups" && scope.t !== "inbox" && <>
            <select className="select" style={{ width: 128, height: 32 }} value={fq ? sort : sort === "relevance" ? "modified" : sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort">
              {fq && <option value="relevance">Best match</option>}<option value="modified">Last modified</option><option value="added">Recently added</option><option value="name">Name</option><option value="size">Largest</option>
            </select>
            <Seg value={view} onChange={setView} options={VIEWS} />
          </>}
        </div>
        {scope.t !== "dups" && scope.t !== "inbox" && stats.length > 1 && (
          <div className="row gap1 scroll" style={{ padding: "8px 18px", flex: "none", borderBottom: "1px solid var(--line)" }}>
            <button className={"chip" + (!kind ? " on" : "")} onClick={() => setKind(null)}>All</button>
            {stats.map((s) => <button key={s.kind} className={"chip" + (kind === s.kind ? " on" : "")} onClick={() => setKind(kind === s.kind ? null : s.kind)}><i className="dot" style={{ "--c": KIND_COLOR[s.kind] } as any} />{KIND_LABEL[s.kind]}<span className="faint num">{s.n}</span></button>)}
            {ext && <button className="chip on" onClick={() => setExt(null)}>.{ext}<Icon name="x" size={10} /></button>}
          </div>
        )}

        <div className="row grow" style={{ minHeight: 0, alignItems: "stretch", gap: 0 }}>
          <div className="col grow" style={{ minHeight: 0, minWidth: 0, position: "relative" }}>
            {scope.t === "dups" ? <Duplicates onPick={setFocus} />
              : scope.t === "inbox" ? <InboxReview onSearch={setText} />
              : shown === 0 ? <Empty icon="search" title={fq ? "Nothing matches that search" : "No files here"}>{fq ? "Search looks at file names and at the text inside documents, slides, spreadsheets and code. Try fewer or different words." : scope.t === "fav" ? "Star a file in the inspector to keep it here." : "This view is empty."}</Empty>
              : view === "spatial" ? <SpatialData base={base} baseKey={baseKey} collections={collections} selected={focus} onSelect={(id) => pick(id)} onOpen={open} />
              : view === "graph" ? <GraphData base={base} baseKey={baseKey} selected={focus} onSelect={(id) => pick(id)} onSearch={(t) => { setText(t); setView("gallery"); }} />
              : view === "timeline" ? <Timeline base={base} baseKey={baseKey} focus={focus} onPick={pick} onOpen={open} />
              : view === "tree" ? <Tree base={base} baseKey={baseKey} flat={!!fq || (scope.t !== "all" && scope.t !== "collection")} files={files} collections={collections} scope={scope} focus={focus} sel={sel} onPick={pick} onOpen={open} more={files.length < shown ? () => setLimit(limit + 200) : undefined} />
              : <Gallery files={files} focus={focus} sel={sel} onPick={pick} onOpen={open} more={files.length < shown ? () => setLimit(limit + 120) : undefined} />}
            {sel.size > 0 && (
              <div className="plate glass row gap3" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: "calc(var(--dock-h) + 16px)", padding: "8px 10px 8px 16px", borderRadius: 16, boxShadow: "var(--shadow)", zIndex: 5 }}>
                <span className="small"><b>{sel.size}</b> selected</span>
                <button className="btn sm primary" onClick={() => set({ handoff: { fileIds: [...sel] } })}><Icon name="send" size={13} />Hand off to an assistant</button>
                <BulkConnect ids={[...sel]} />
                <button className="btn sm" onClick={() => batch([...sel].map((id) => ({ sql: "UPDATE files SET favourite = 1 WHERE id = ?", params: [id] })))}><Icon name="star" size={13} />Favourite</button>
                <button className="btn sm ghost" onClick={() => setSel(new Set())}>Clear</button>
              </div>
            )}
          </div>
          {focus != null && scope.t !== "inbox" && <Inspector id={focus} needle={search} onClose={() => setFocus(null)} onSearch={(t) => { setText(t); setView("gallery"); }} />}
        </div>
      </div>
    </div>
  );
}

function RailItem({ icon, label, count, on, onClick, accent }: { icon: string; label: string; count?: number; on: boolean; onClick: () => void; accent?: boolean }) {
  return <button className={"list-row small" + (on ? " on" : "")} style={{ padding: "7px 8px", textAlign: "left" }} onClick={onClick}><Icon name={icon} size={15} style={{ color: on ? "var(--hue)" : "var(--ink-3)", flex: "none" }} /><span className="grow">{label}</span>{count ? <span className={accent ? "chip tint" : "faint num"} style={accent ? { height: 18, padding: "0 7px", fontSize: 10.5 } : { fontSize: 10.5 }}>{count}</span> : null}</button>;
}

function BulkConnect({ ids }: { ids: number[] }) {
  const courses = useRows<any>("SELECT id, name FROM courses WHERE archived = 0 ORDER BY name");
  const projects = useRows<any>("SELECT id, name FROM projects ORDER BY name");
  const all = async (type: string, id: number, name: string) => { for (const f of ids) await link("file", f, type, id); toast(`Connected ${plural(ids.length, "file")} to ${name}.`, "good"); };
  return <Menu button={<button className="btn sm"><Icon name="link" size={13} />Connect to…</button>}>{(close) => <div className="scroll" style={{ maxHeight: 240 }}>
    {courses.length + projects.length === 0 && <div className="small faint" style={{ padding: 8 }}>Create a course or project first.</div>}
    {courses.map((c) => <MenuItem key={"c" + c.id} icon="academy" onClick={() => { close(); void all("course", c.id, c.name); }}>{c.name}</MenuItem>)}
    {projects.map((p) => <MenuItem key={"p" + p.id} icon="projects" onClick={() => { close(); void all("project", p.id, p.name); }}>{p.name}</MenuItem>)}
  </div>}</Menu>;
}

type PickFn = (id: number, e?: { ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }) => void;

function Gallery({ files, focus, sel, onPick, onOpen, more }: { files: FileRow[]; focus: number | null; sel: Set<number>; onPick: PickFn; onOpen: (id: number) => void; more?: () => void }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!more || !end.current) return;
    const io = new IntersectionObserver(([e]) => e.isIntersecting && more(), { rootMargin: "400px" });
    io.observe(end.current);
    return () => io.disconnect();
  }, [more, files.length]);
  return (
    <div className="scroll" style={{ padding: "18px 18px calc(var(--dock-h) + 30px)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(178px, 1fr))", gap: 12 }}>
        {files.map((f) => (
          <button key={f.id} className={"plate hover kind-" + f.kind} onClick={(e) => onPick(f.id, e)} onDoubleClick={() => onOpen(f.id)} title={f.path}
            style={{ textAlign: "left", borderRadius: 14, overflow: "hidden", display: "flex", flexDirection: "column", outline: focus === f.id ? "1.5px solid var(--hue)" : sel.has(f.id) ? "1.5px solid var(--ink-2)" : "none", opacity: f.missing ? 0.5 : 1 }}>
            <div style={{ height: 118, position: "relative", background: "color-mix(in srgb, var(--c) 7%, transparent)", borderBottom: "1px solid var(--line)", overflow: "hidden" }}>
              {f.kind === "image" && !f.missing ? <img loading="lazy" src={fileUrl(f.path, true)} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                : f.snip || f.excerpt ? <div style={{ padding: "10px 12px", fontSize: 9.5, lineHeight: 1.5, color: "var(--ink-3)", fontFamily: f.kind === "code" ? "var(--font-mono)" : undefined, height: "100%", overflow: "hidden", maskImage: "linear-gradient(#000 60%, transparent)" }}>{f.snip ? <Snip text={f.snip} /> : f.excerpt}</div>
                : <div style={{ height: "100%", display: "grid", placeItems: "center" }}><Icon name={KIND_ICON[f.kind]} size={34} stroke={1} style={{ color: "var(--c)", opacity: 0.8 }} /></div>}
              <span className="chip tint" style={{ position: "absolute", left: 8, bottom: 8, height: 18, fontSize: 9.5, padding: "0 7px", backdropFilter: "blur(8px)", background: "var(--glass)" }}>{(f.ext || f.kind).toUpperCase()}</span>
              {f.favourite ? <Icon name="star" size={13} style={{ position: "absolute", right: 9, top: 9, color: "var(--hue-home)", fill: "var(--hue-home)" }} /> : null}
              {sel.has(f.id) && <span className="check on" style={{ position: "absolute", left: 8, top: 8 }}><Icon name="check" size={12} stroke={2.4} /></span>}
            </div>
            <div style={{ padding: "9px 12px 11px" }}>
              <div className="small clamp2" style={{ wordBreak: "break-word", minHeight: 36 }}>{f.name}</div>
              <div className="faint row between" style={{ fontSize: 10.5, marginTop: 4 }}><span>{f.missing ? "missing" : ago(f.mtime)}</span><span className="num">{bytes(f.size)}</span></div>
            </div>
          </button>
        ))}
      </div>
      <div ref={end} style={{ height: 1 }} />
      <p className="small faint" style={{ textAlign: "center", marginTop: 18 }}>Ctrl + click to select several · double-click to open</p>
    </div>
  );
}

function FileLine({ f, depth = 0, focus, sel, onPick, onOpen }: { f: FileRow; depth?: number; focus: number | null; sel: Set<number>; onPick: PickFn; onOpen: (id: number) => void }) {
  return (
    <div className={"list-row small kind-" + f.kind + (focus === f.id || sel.has(f.id) ? " on" : "")} style={{ padding: "5px 10px", paddingLeft: 10 + depth * 18, cursor: "pointer", opacity: f.missing ? 0.5 : 1 }} onClick={(e) => onPick(f.id, e)} onDoubleClick={() => onOpen(f.id)}>
      <Icon name={KIND_ICON[f.kind]} size={15} style={{ color: "var(--c)", flex: "none" }} />
      <div className="col grow" style={{ gap: 0 }}><span className="truncate">{f.name}</span>{f.snip?.includes("‹") && <span className="faint truncate" style={{ fontSize: 11 }}><Snip text={f.snip} /></span>}</div>
      {f.favourite ? <Icon name="star" size={12} style={{ color: "var(--hue-home)" }} /> : null}
      {f.missing ? <span className="bad">missing</span> : null}
      <span className="faint" style={{ width: 86, textAlign: "right" }}>{KIND_LABEL[f.kind]}</span>
      <span className="faint num" style={{ width: 70, textAlign: "right" }}>{bytes(f.size)}</span>
      <span className="faint" style={{ width: 92, textAlign: "right" }}>{fmtDate(new Date(f.mtime))}</span>
    </div>
  );
}

interface Dir { name: string; path: string; n: number; children: Dir[] }
function Tree({ base, baseKey, flat, files, collections, scope, focus, sel, onPick, onOpen, more }: { base: { from: string; params: any[] }; baseKey: string; flat: boolean; files: FileRow[]; collections: any[]; scope: Scope; focus: number | null; sel: Set<number>; onPick: PickFn; onOpen: (id: number) => void; more?: () => void }) {
  const parents = useQ<any[]>(() => (flat ? Promise.resolve([]) : q(`SELECT f.parent, f.collection_id, COUNT(*) n ${base.from} GROUP BY f.parent, f.collection_id`, base.params)), [baseKey, flat]).data ?? [];
  const [open, setOpen] = useState<Set<string>>(new Set());
  const roots = useMemo(() => {
    const out: Dir[] = [];
    for (const c of collections) {
      if (scope.t === "collection" && scope.id !== c.id) continue;
      const mine = parents.filter((p) => p.collection_id === c.id);
      if (!mine.length) continue;
      const root: Dir = { name: c.name, path: c.root_path.startsWith("::") ? "::" + c.id : c.root_path, n: 0, children: [] };
      const index = new Map<string, Dir>([[root.path, root]]);
      for (const p of mine) {
        if (c.root_path.startsWith("::")) { root.n += p.n; continue; }
        const sep = p.parent.includes("\\") ? "\\" : "/";
        let cur = root, acc = c.root_path;
        for (const seg of p.parent.slice(c.root_path.length).split(/[\\/]/).filter(Boolean)) {
          acc += sep + seg;
          let next = index.get(acc);
          if (!next) { next = { name: seg, path: acc, n: 0, children: [] }; index.set(acc, next); cur.children.push(next); }
          cur = next;
        }
        cur.n += p.n;
      }
      const total = (d: Dir): number => { d.children.sort((a, b) => a.name.localeCompare(b.name)); return (d.n += d.children.reduce((s, ch) => s + total(ch), 0)); };
      total(root);
      out.push(root);
    }
    return out;
  }, [parents, collections, scope]);
  useEffect(() => { if (roots.length === 1) setOpen((o) => new Set(o).add(roots[0].path)); }, [roots.length === 1 ? roots[0].path : ""]);

  const head = <div className="list-row label" style={{ padding: "8px 10px", position: "sticky", top: 0, background: "var(--bg-2)", zIndex: 1, borderRadius: 0 }}><span className="grow">Name</span><span style={{ width: 86, textAlign: "right" }}>Type</span><span style={{ width: 70, textAlign: "right" }}>Size</span><span style={{ width: 92, textAlign: "right" }}>Modified</span></div>;
  if (flat) return <div className="scroll" style={{ padding: "0 8px calc(var(--dock-h) + 30px)" }}>{head}{files.map((f) => <FileLine key={f.id} f={f} focus={focus} sel={sel} onPick={onPick} onOpen={onOpen} />)}{more && <button className="btn sm ghost" style={{ margin: "10px auto", display: "flex" }} onClick={more}>Show more</button>}</div>;
  const render = (d: Dir, depth: number): React.ReactNode => {
    const isOpen = open.has(d.path);
    return (
      <div key={d.path}>
        <div className="list-row small" style={{ padding: "5px 10px", paddingLeft: 10 + depth * 18, cursor: "pointer" }} onClick={() => { const n = new Set(open); isOpen ? n.delete(d.path) : n.add(d.path); setOpen(n); }}>
          <Icon name={isOpen ? "chevD" : "chevR"} size={12} style={{ color: "var(--ink-3)", flex: "none" }} /><Icon name="folder" size={15} style={{ color: "var(--hue)", flex: "none" }} /><span className="grow truncate">{d.name}</span><span className="faint num">{plural(d.n, "file")}</span>
        </div>
        {isOpen && <>{d.children.map((c) => render(c, depth + 1))}<FolderFiles base={base} dir={d} depth={depth + 1} focus={focus} sel={sel} onPick={onPick} onOpen={onOpen} /></>}
      </div>
    );
  };
  return <div className="scroll" style={{ padding: "0 8px calc(var(--dock-h) + 30px)" }}>{head}{roots.map((r) => render(r, 0))}</div>;
}
function FolderFiles({ base, dir, depth, ...rest }: { base: { from: string; params: any[] }; dir: Dir; depth: number; focus: number | null; sel: Set<number>; onPick: PickFn; onOpen: (id: number) => void }) {
  const loose = dir.path.startsWith("::");
  const rows = useRows<FileRow>(`SELECT f.* ${base.from} AND ${loose ? "f.collection_id = ?" : "f.parent = ?"} ORDER BY f.name COLLATE NOCASE LIMIT 500`, [...base.params, loose ? +dir.path.slice(2) : dir.path]);
  return <>{rows.map((f) => <FileLine key={f.id} f={f} depth={depth} {...rest} />)}</>;
}

function SpatialData({ base, baseKey, collections, selected, onSelect, onOpen }: { base: { from: string; params: any[] }; baseKey: string; collections: any[]; selected: number | null; onSelect: (id: number) => void; onOpen: (id: number) => void }) {
  const files = useQ<any[]>(() => q(`SELECT f.id, f.name, f.parent, f.size, f.kind, f.collection_id ${base.from} ORDER BY f.size DESC LIMIT 8000`, base.params), [baseKey]).data;
  if (!files) return null;
  return <SpatialView files={files} collections={collections} selected={selected} onSelect={onSelect} onOpen={onOpen} />;
}
function GraphData({ base, baseKey, selected, onSelect, onSearch }: { base: { from: string; params: any[] }; baseKey: string; selected: number | null; onSelect: (id: number) => void; onSearch: (t: string) => void }) {
  const ids = useQ<any[]>(() => q(`SELECT f.id ${base.from} ORDER BY (f.text_len > 0) DESC, f.mtime DESC LIMIT 501`, base.params), [baseKey]).data;
  if (!ids) return null;
  return <GraphView fileIds={ids.map((r) => r.id)} selected={selected} onSelect={onSelect} onSearch={onSearch} />;
}

function Timeline({ base, baseKey, focus, onPick, onOpen }: { base: { from: string; params: any[] }; baseKey: string; focus: number | null; onPick: PickFn; onOpen: (id: number) => void }) {
  const [by, setBy] = useState<"mtime" | "imported_at">("mtime");
  const months = useQ<any[]>(() => q(`SELECT strftime('%Y-%m', f.${by} / 1000, 'unixepoch', 'localtime') m, COUNT(*) n ${base.from} GROUP BY m ORDER BY m`, base.params), [baseKey, by]).data ?? [];
  const [month, setMonth] = useState<string | null>(null);
  const active = month && months.some((m) => m.m === month) ? month : months.at(-1)?.m ?? null;
  const rows = useRows<FileRow>(`SELECT f.* ${base.from} AND strftime('%Y-%m', f.${by} / 1000, 'unixepoch', 'localtime') = ? ORDER BY f.${by} DESC LIMIT 400`, [...base.params, active ?? ""], !!active);
  const max = Math.max(1, ...months.map((m) => m.n));
  const days = useMemo(() => { const g = new Map<string, FileRow[]>(); for (const f of rows) { const k = fmtDate(new Date((f as any)[by]), "long"); g.set(k, [...(g.get(k) ?? []), f]); } return [...g.entries()]; }, [rows, by]);
  return (
    <div className="col grow" style={{ minHeight: 0 }}>
      <div style={{ padding: "14px 18px 0", flex: "none" }}>
        <div className="row between"><span className="label">Files by month {by === "mtime" ? "last modified" : "added to your universe"}</span><Seg value={by} onChange={setBy} options={[{ value: "mtime", label: "Modified" }, { value: "imported_at", label: "Added" }]} /></div>
        <div className="row scroll" style={{ alignItems: "flex-end", gap: 3, height: 120, padding: "14px 0 0" }}>
          {months.map((m) => (
            <button key={m.m} onClick={() => setMonth(m.m)} title={`${MONTHS[+m.m.slice(5) - 1]} ${m.m.slice(0, 4)} · ${plural(m.n, "file")}`} style={{ flex: "1 0 14px", maxWidth: 46, height: "100%", display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "center", gap: 5 }}>
              <div style={{ width: "100%", height: `${Math.max(4, (m.n / max) * 78)}px`, borderRadius: 4, background: m.m === active ? "var(--hue)" : "var(--plate-3)", boxShadow: m.m === active ? "0 0 18px -2px var(--hue)" : "none", transition: "all var(--med)" }} />
              <span className="mono" style={{ fontSize: 9, color: m.m === active ? "var(--ink)" : "var(--ink-4)", whiteSpace: "nowrap" }}>{m.m.slice(5) === "01" || m === months[0] ? m.m.slice(2).replace("-", "/") : m.m.slice(5)}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="scroll" style={{ padding: "8px 18px calc(var(--dock-h) + 30px)" }}>
        {active && <h2 className="display" style={{ fontSize: 28, margin: "10px 0 6px" }}>{MONTHS[+active.slice(5) - 1]} {active.slice(0, 4)}</h2>}
        {days.map(([day, list]) => (
          <div key={day} style={{ display: "grid", gridTemplateColumns: "190px 1fr", gap: 12, padding: "10px 0", borderTop: "1px solid var(--line)" }}>
            <span className="small faint" style={{ paddingTop: 6 }}>{day}</span>
            <div>{list.map((f) => <FileLine key={f.id} f={f} focus={focus} sel={new Set()} onPick={onPick} onOpen={onOpen} />)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Duplicates({ onPick }: { onPick: (id: number) => void }) {
  const rows = useRows<any>("SELECT f.id, f.name, f.path, f.size, f.hash, f.kind, f.mtime FROM files f WHERE f.missing = 0 AND f.hash IN (SELECT hash FROM files WHERE hash IS NOT NULL AND missing = 0 GROUP BY hash HAVING COUNT(*) > 1) ORDER BY f.size DESC, f.hash, f.mtime");
  const groups = useMemo(() => { const g = new Map<string, any[]>(); for (const r of rows) g.set(r.hash, [...(g.get(r.hash) ?? []), r]); return [...g.values()]; }, [rows]);
  if (!groups.length) return <Empty icon="duplicate" title="No duplicates">Every indexed file has unique content.</Empty>;
  return (
    <div className="scroll col gap3" style={{ padding: "18px 18px calc(var(--dock-h) + 30px)" }}>
      <p className="small dim" style={{ maxWidth: 720 }}>These files have byte-identical content (matched by fingerprint, not by name). Personal Universe never deletes originals — use “Show in Explorer” to tidy up yourself, then rescan.</p>
      {groups.map((g) => (
        <div key={g[0].hash} className={"plate kind-" + g[0].kind} style={{ padding: "12px 14px" }}>
          <div className="row between" style={{ marginBottom: 6 }}><span className="row"><Icon name={KIND_ICON[g[0].kind]} size={15} style={{ color: "var(--c)" }} /><b>{g[0].name}</b></span><span className="small faint">{g.length} copies · {bytes(g[0].size)} each · {bytes(g[0].size * (g.length - 1))} recoverable</span></div>
          {g.map((f, i) => (
            <div key={f.id} className="list-row small" style={{ padding: "5px 8px" }}>
              <span className="mono faint" style={{ width: 16 }}>{i + 1}</span>
              <button className="grow truncate selectable" style={{ textAlign: "left" }} onClick={() => onPick(f.id)}>{f.path}</button>
              <span className="faint">{fmtDate(new Date(f.mtime))}</span>
              {isTauri && <button className="btn sm ghost" onClick={() => attempt(() => native.reveal(f.path))}>Show in Explorer</button>}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/** A calm, one-at-a-time way through whatever was thrown at the drop zone. */
function InboxReview({ onSearch }: { onSearch: (t: string) => void }) {
  const queue = useRows<FileRow>("SELECT * FROM files WHERE inbox_state = 'new' ORDER BY imported_at DESC, id DESC");
  const reviewed = useRows<any>("SELECT COUNT(*) n FROM files WHERE inbox_state = 'done'")[0]?.n ?? 0;
  const courses = useRows<any>("SELECT id, name, color FROM courses WHERE archived = 0 ORDER BY name");
  const projects = useRows<any>("SELECT id, name, color FROM projects WHERE status != 'done' ORDER BY name");
  const [cur, setCur] = useState<number | null>(null);
  const [tag, setTag] = useState("");
  const file = queue.find((f) => f.id === cur) ?? queue[0];
  const links = useRows<any>("SELECT b_type type, b_id id FROM links WHERE a_type = 'file' AND a_id = ?", [file?.id ?? 0], !!file);
  const tags = useRows<any>("SELECT t.name FROM tags t JOIN file_tags ft ON ft.tag_id = t.id WHERE ft.file_id = ?", [file?.id ?? 0], !!file);
  const done = async () => { if (!file) return; const i = queue.findIndex((f) => f.id === file.id); setCur(queue[i + 1]?.id ?? queue[i - 1]?.id ?? null); await run("UPDATE files SET inbox_state = 'done' WHERE id = ?", [file.id]); };
  const addTag = async () => { const n = tag.trim().toLowerCase(); if (!n || !file) return; await call("db.exec", { sql: "INSERT OR IGNORE INTO tags(name, color) VALUES(?, ?)", params: [n, PALETTE[n.length % PALETTE.length]] }); await run("INSERT OR IGNORE INTO file_tags(file_id, tag_id) SELECT ?, id FROM tags WHERE name = ?", [file.id, n]); setTag(""); };
  if (!file) return <Empty icon="inbox" title="Inbox zero" action={<><button className="btn" onClick={() => pickAndImport("files", { inbox: true })}><Icon name="upload" size={14} />Add files to review</button></>}>Drop loose downloads, screenshots and documents on the right half of the window. They wait here until you have looked at them{reviewed ? ` — ${reviewed} reviewed so far` : ""}. Nothing is ever moved from where it was.</Empty>;
  return (
    <div className="row grow" style={{ minHeight: 0, alignItems: "stretch", gap: 0 }}>
      <div className="scroll" style={{ width: 250, flex: "none", padding: "12px 8px calc(var(--dock-h) + 20px)", borderRight: "1px solid var(--line)" }}>
        <div className="label" style={{ padding: "4px 10px 8px" }}>{plural(queue.length, "item")} to review</div>
        {queue.map((f) => <button key={f.id} className={"list-row small kind-" + f.kind + (f.id === file.id ? " on" : "")} style={{ width: "100%", textAlign: "left" }} onClick={() => setCur(f.id)}><Icon name={KIND_ICON[f.kind]} size={15} style={{ color: "var(--c)", flex: "none" }} /><div className="col grow" style={{ gap: 0 }}><span className="truncate">{f.name}</span><span className="faint" style={{ fontSize: 10.5 }}>{ago(f.imported_at)} · {bytes(f.size)}</span></div></button>)}
      </div>
      <div className="scroll col gap4 grow" style={{ padding: "20px 28px calc(var(--dock-h) + 30px)", minWidth: 0 }}>
        <div className="row between gap4"><div className="col" style={{ gap: 2, minWidth: 0 }}><h2 className="title truncate selectable">{file.name}</h2><span className="small faint truncate selectable">{file.parent}</span></div>
          <div className="row"><button className="btn" onClick={() => openFile(file)} disabled={!isTauri}><Icon name="external" size={14} />Open</button><button className="btn primary" onClick={done}><Icon name="check" size={14} />Reviewed — next</button></div></div>
        <Preview file={file} tall />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 22 }}>
          <div className="col gap1"><span className="label">File under a project</span><div className="row wrap gap1">{projects.length === 0 && <span className="small faint">No projects yet.</span>}{projects.map((p) => { const on = links.some((l) => l.type === "project" && l.id === p.id); return <button key={p.id} className={"chip tint" + (on ? " on" : "")} style={{ "--c": p.color, opacity: on ? 1 : 0.7 } as any} onClick={() => (on ? run("DELETE FROM links WHERE a_type='file' AND a_id=? AND b_type='project' AND b_id=?", [file.id, p.id]) : link("file", file.id, "project", p.id))}>{on && <Icon name="check" size={10} />}{p.name}</button>; })}</div></div>
          <div className="col gap1"><span className="label">Attach to a course</span><div className="row wrap gap1">{courses.length === 0 && <span className="small faint">No courses yet.</span>}{courses.map((c) => { const on = links.some((l) => l.type === "course" && l.id === c.id); return <button key={c.id} className={"chip tint" + (on ? " on" : "")} style={{ "--c": c.color, opacity: on ? 1 : 0.7 } as any} onClick={() => (on ? run("DELETE FROM links WHERE a_type='file' AND a_id=? AND b_type='course' AND b_id=?", [file.id, c.id]) : link("file", file.id, "course", c.id))}>{on && <Icon name="check" size={10} />}{c.name}</button>; })}</div></div>
          <div className="col gap1"><span className="label">Tag it</span><div className="row wrap gap1">{tags.map((t) => <span key={t.name} className="chip">#{t.name}</span>)}<input className="input" style={{ height: 26, width: 130 }} value={tag} onChange={(e) => setTag(e.target.value)} onKeyDown={(e) => e.key === "Enter" && addTag()} placeholder="type + Enter" /></div></div>
        </div>
      </div>
    </div>
  );
}
