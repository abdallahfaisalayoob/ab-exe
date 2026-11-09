// The two spatial ways of seeing a library.
//  • SpatialView — a zoomable map: folders are regions, files are bodies sized by weight
//    and coloured by type. It answers "what is in here, and where is the mass?" at a glance.
//  • GraphView — the living knowledge map: files joined by the key terms they share and by
//    the courses, projects and tags they were connected to. Only established links are drawn.
import { useEffect, useMemo, useRef, useState } from "react";
import { hierarchy, pack, HierarchyCircularNode } from "d3-hierarchy";
import { interpolateZoom } from "d3-interpolate";
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import { q } from "../lib/backend";
import { bytes, KIND_COLOR, KIND_LABEL, plural } from "../lib/format";
import { useQ, useSize } from "../lib/hooks";
import { Icon } from "../ui/Icons";
import { Empty } from "../ui/kit";

interface MapFile { id: number; name: string; parent: string; size: number; kind: string; collection_id: number }
interface Datum { name: string; file?: MapFile; children?: Datum[]; value?: number; path?: string }
type Node = HierarchyCircularNode<Datum>;
const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

export function SpatialView({ files, collections, selected, onSelect, onOpen }: { files: MapFile[]; collections: { id: number; name: string; root_path: string }[]; selected: number | null; onSelect: (id: number) => void; onOpen: (id: number) => void }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const view = useRef<[number, number, number]>([500, 500, 1000]);
  const anim = useRef(0);
  const [focus, setFocus] = useState<Node | null>(null);
  const [hover, setHover] = useState<{ node: Node; x: number; y: number } | null>(null);

  const root = useMemo(() => {
    const cols = new Map(collections.map((c) => [c.id, c]));
    const top: Datum = { name: "Everything", children: [] };
    const dirs = new Map<string, Datum>();
    const colNode = (id: number) => {
      const key = "c" + id;
      if (!dirs.has(key)) { const d: Datum = { name: cols.get(id)?.name ?? "Collection", children: [], path: cols.get(id)?.root_path }; dirs.set(key, d); top.children!.push(d); }
      return dirs.get(key)!;
    };
    for (const f of files) {
      const col = cols.get(f.collection_id);
      let node = colNode(f.collection_id);
      if (col && !col.root_path.startsWith("::") && f.parent.startsWith(col.root_path)) {
        let acc = "c" + col.id;
        for (const seg of f.parent.slice(col.root_path.length).split(/[\\/]/).filter(Boolean)) {
          acc += "/" + seg;
          let next = dirs.get(acc);
          if (!next) { next = { name: seg, children: [] }; dirs.set(acc, next); node.children!.push(next); }
          node = next;
        }
      }
      node.children!.push({ name: f.name, file: f, value: Math.sqrt(Math.max(f.size, 6000)) });
    }
    const data = top.children!.length === 1 ? top.children![0] : top;
    const tree = hierarchy(data).sum((d) => d.value ?? 0).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return pack<Datum>().size([1000, 1000]).padding((d) => (d.depth === 0 ? 14 : 5))(tree);
  }, [files, collections]);

  useEffect(() => { setFocus(root); view.current = [root.x, root.y, root.r * 2.08]; draw(); /* eslint-disable-next-line */ }, [root]);

  const draw = () => {
    const c = canvas.current;
    if (!c || !w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const [vx, vy, vr] = view.current;
    const k = Math.min(w, h - 90) / vr;
    const ink = css("--ink"), ink3 = css("--ink-3"), hue = css("--hue-knowledge");
    const light = document.documentElement.dataset.theme === "daylight";
    root.each((n) => {
      const x = (n.x - vx) * k + w / 2, y = (n.y - vy) * k + (h - 90) / 2, r = n.r * k;
      if (r < 0.7 || x + r < 0 || x - r > w || y + r < 0 || y - r > h) return;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2);
      if (n.data.file) {
        const col = KIND_COLOR[n.data.file.kind] ?? "#888";
        g.globalAlpha = n.data.file.id === selected ? 1 : 0.78;
        g.fillStyle = col; g.fill();
        if (n.data.file.id === selected) { g.globalAlpha = 1; g.lineWidth = 2; g.strokeStyle = ink; g.stroke(); }
      } else {
        g.globalAlpha = 1;
        g.fillStyle = light ? `rgba(20,30,40,${0.03 + n.depth * 0.012})` : `rgba(255,255,255,${0.018 + n.depth * 0.012})`; g.fill();
        g.lineWidth = n === focus ? 1.4 : 1; g.strokeStyle = n === focus ? hue : light ? "rgba(20,30,40,.14)" : "rgba(255,255,255,.11)"; g.stroke();
      }
    });
    // Labels last, so they sit above the bodies.
    g.globalAlpha = 1; g.textAlign = "center";
    root.each((n) => {
      const x = (n.x - vx) * k + w / 2, y = (n.y - vy) * k + (h - 90) / 2, r = n.r * k;
      if (x + r < 0 || x - r > w || y + r < 0 || y - r > h) return;
      if (!n.data.file && n.parent === focus && r > 34) {
        g.font = `500 ${Math.min(15, Math.max(11, r / 7))}px ${css("--font-ui")}`; g.fillStyle = ink;
        g.fillText(fit(g, n.data.name, r * 1.7), x, y - r + Math.min(22, r * 0.34));
        g.font = `500 9.5px ${css("--font-mono")}`; g.fillStyle = ink3;
        g.fillText(`${n.leaves().length} FILES`, x, y - r + Math.min(22, r * 0.34) + 14);
      } else if (n.data.file && r > 30) {
        g.font = `500 ${Math.min(13, r / 4.2)}px ${css("--font-ui")}`; g.fillStyle = "#0B0D12";
        g.fillText(fit(g, n.data.name, r * 1.7), x, y + 4);
      }
    });
  };
  useEffect(draw);

  const zoomTo = (n: Node) => {
    cancelAnimationFrame(anim.current);
    setFocus(n);
    const i = interpolateZoom(view.current, [n.x, n.y, n.r * 2.08]);
    const start = performance.now(), dur = Math.min(900, Math.max(350, i.duration * 0.7));
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / dur), e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
      view.current = i(e) as [number, number, number];
      draw();
      if (t < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const hit = (e: React.MouseEvent): Node | null => {
    const rect = canvas.current!.getBoundingClientRect();
    const [vx, vy, vr] = view.current, k = Math.min(w, h - 90) / vr;
    const px = (e.clientX - rect.left - w / 2) / k + vx, py = (e.clientY - rect.top - (h - 90) / 2) / k + vy;
    let found: Node | null = null;
    const visit = (n: Node) => { if (Math.hypot(px - n.x, py - n.y) <= n.r) { found = n; n.children?.forEach(visit); } };
    visit(root);
    return found;
  };
  /** The node the user means: the child of the focused region under the cursor. */
  const target = (n: Node | null): Node | null => {
    if (!n || !focus) return null;
    if (n.data.file && n.r * (Math.min(w, h - 90) / view.current[2]) > 5) return n;
    let cur: Node = n;
    while (cur.parent && cur.parent !== focus && cur.ancestors().includes(focus)) cur = cur.parent;
    return cur;
  };

  if (!files.length) return <Empty icon="orbit" title="Nothing to map yet">Import a folder and it will unfold here as a map you can fly through.</Empty>;
  const trail = focus ? focus.ancestors().reverse() : [];
  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minHeight: 0 }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", cursor: hover ? "pointer" : "default" }}
        onMouseMove={(e) => { const n = target(hit(e)); setHover(n && n !== focus ? { node: n, x: e.clientX, y: e.clientY } : null); }}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { const n = target(hit(e)); if (!n || n === focus) { if (focus?.parent) zoomTo(focus.parent); } else if (n.data.file) onSelect(n.data.file.id); else zoomTo(n); }}
        onDoubleClick={(e) => { const n = hit(e); if (n?.data.file) onOpen(n.data.file.id); }} />
      <div className="row gap1" style={{ position: "absolute", left: 18, top: 12, flexWrap: "wrap" }}>
        {trail.map((n, i) => <button key={i} className={"chip" + (n === focus ? " on" : "")} onClick={() => zoomTo(n)}>{i > 0 && <Icon name="chevR" size={10} />}{n.data.name}</button>)}
      </div>
      <div className="row gap3 small faint" style={{ position: "absolute", left: 18, bottom: "calc(var(--dock-h) + 22px)", flexWrap: "wrap", maxWidth: "60%" }}>
        {[...new Set(files.map((f) => f.kind))].slice(0, 8).map((k) => <span key={k} className="row gap1"><i className="dot" style={{ "--c": KIND_COLOR[k] } as any} />{KIND_LABEL[k]}</span>)}
      </div>
      <div className="small faint" style={{ position: "absolute", right: 18, top: 14 }}>Click a region to enter · click empty space to step back · size = file size</div>
      {hover && <div className="tip" style={{ left: hover.x, top: hover.y }}><b>{hover.node.data.name}</b><br /><span className="faint">{hover.node.data.file ? `${KIND_LABEL[hover.node.data.file.kind]} · ${bytes(hover.node.data.file.size)}` : `${plural(hover.node.leaves().length, "file")} · ${bytes(hover.node.leaves().reduce((s, l) => s + (l.data.file?.size ?? 0), 0))}`}</span></div>}
    </div>
  );
}
function fit(g: CanvasRenderingContext2D, text: string, max: number) {
  if (g.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 3 && g.measureText(t + "…").width > max) t = t.slice(0, -1);
  return t + "…";
}

// ── Knowledge graph ──────────────────────────────────────────────────────────
interface GNode { id: string; type: "file" | "term" | "course" | "project" | "tag"; label: string; color: string; size: number; fileId?: number; kind?: string; x?: number; y?: number; fx?: number | null; fy?: number | null }
interface GLink { source: any; target: any; w: number }

export function GraphView({ fileIds, selected, onSelect, onSearch }: { fileIds: number[]; selected: number | null; onSelect: (id: number) => void; onSearch: (t: string) => void }) {
  const [ref, { w, h }] = useSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const tf = useRef({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<GNode | null>(null);
  const [pinned, setPinned] = useState<GNode | null>(null);
  const [filter, setFilter] = useState("");
  const dragging = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const ids = fileIds.slice(0, 500);

  const graph = useQ(async () => {
    if (!ids.length) return { nodes: [] as GNode[], links: [] as GLink[], shown: 0 };
    const marks = ids.map(() => "?").join(",");
    const [files, terms, links, tags] = await Promise.all([
      q<any>(`SELECT id, name, kind FROM files WHERE id IN (${marks})`, ids),
      q<any>(`SELECT file_id, term, weight FROM file_terms WHERE file_id IN (${marks})`, ids),
      q<any>(`SELECT l.a_id file_id, l.b_type type, l.b_id id, COALESCE(c.name, p.name) name, COALESCE(c.color, p.color) color FROM links l LEFT JOIN courses c ON l.b_type = 'course' AND c.id = l.b_id LEFT JOIN projects p ON l.b_type = 'project' AND p.id = l.b_id WHERE l.a_type = 'file' AND l.a_id IN (${marks})`, ids),
      q<any>(`SELECT ft.file_id, t.id, t.name, t.color FROM file_tags ft JOIN tags t ON t.id = ft.tag_id WHERE ft.file_id IN (${marks})`, ids),
    ]);
    // A term becomes a node only if at least two files share it and it is not near-universal.
    const df = new Map<string, number>();
    for (const t of terms) df.set(t.term, (df.get(t.term) ?? 0) + 1);
    const withText = new Set(terms.map((t: any) => t.file_id)).size;
    const keep = new Set([...df.entries()].filter(([, n]) => n >= 2 && (withText < 8 || n <= withText * 0.6)).sort((a, b) => b[1] - a[1]).slice(0, 48).map(([t]) => t));
    const nodes = new Map<string, GNode>();
    const out: GLink[] = [];
    const fileNode = (id: number) => { const f = files.find((x: any) => x.id === id); if (!f) return null; const key = "f" + id; if (!nodes.has(key)) nodes.set(key, { id: key, type: "file", label: f.name, color: KIND_COLOR[f.kind] ?? "#888", size: 4.5, fileId: id, kind: f.kind }); return key; };
    for (const t of terms) if (keep.has(t.term)) { const f = fileNode(t.file_id); if (!f) continue; const key = "t" + t.term; if (!nodes.has(key)) nodes.set(key, { id: key, type: "term", label: t.term, color: "", size: 3 + Math.min(9, df.get(t.term)! * 1.2) }); out.push({ source: f, target: key, w: t.weight }); }
    for (const l of links) { const f = fileNode(l.file_id); if (!f || !l.name) continue; const key = l.type[0] + "e" + l.id; if (!nodes.has(key)) nodes.set(key, { id: key, type: l.type, label: l.name, color: l.color, size: 11 }); out.push({ source: f, target: key, w: 1 }); }
    for (const t of tags) { const f = fileNode(t.file_id); if (!f) continue; const key = "g" + t.id; if (!nodes.has(key)) nodes.set(key, { id: key, type: "tag", label: "#" + t.name, color: t.color ?? "#999", size: 7 }); out.push({ source: f, target: key, w: 1 }); }
    const list = [...nodes.values()];
    const sim = forceSimulation(list as any).force("link", forceLink(out).id((d: any) => d.id).distance((l: any) => (l.target.type === "term" ? 54 : 78)).strength(0.5)).force("charge", forceManyBody().strength(-110)).force("collide", forceCollide().radius((d: any) => d.size + 8)).force("center", forceCenter(0, 0)).force("x", forceX().strength(0.04)).force("y", forceY().strength(0.05)).stop();
    for (let i = 0; i < 260; i++) sim.tick();
    return { nodes: list, links: out, shown: list.filter((n) => n.type === "file").length };
  }, [ids.join(",")]).data;

  const neighbours = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const l of graph?.links ?? []) { const a = l.source.id ?? l.source, b = l.target.id ?? l.target; (m.get(a) ?? m.set(a, new Set()).get(a)!).add(b); (m.get(b) ?? m.set(b, new Set()).get(b)!).add(a); }
    return m;
  }, [graph]);

  useEffect(() => {
    if (!graph?.nodes.length || !w) return;
    const xs = graph.nodes.map((n) => n.x!), ys = graph.nodes.map((n) => n.y!);
    const spanX = Math.max(...xs) - Math.min(...xs) + 160, spanY = Math.max(...ys) - Math.min(...ys) + 200;
    tf.current = { k: Math.min(1.6, Math.min(w / spanX, (h - 80) / spanY)), x: w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * 1, y: h / 2 - 30 };
    tf.current.x = w / 2 - ((Math.max(...xs) + Math.min(...xs)) / 2) * tf.current.k;
    tf.current.y = (h - 60) / 2 - ((Math.max(...ys) + Math.min(...ys)) / 2) * tf.current.k;
    draw();
    // eslint-disable-next-line
  }, [graph, w, h]);

  const active = pinned ?? hover;
  const draw = () => {
    const c = canvas.current;
    if (!c || !graph || !w) return;
    const dpr = window.devicePixelRatio || 1;
    if (c.width !== w * dpr || c.height !== h * dpr) { c.width = w * dpr; c.height = h * dpr; }
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    const { x: tx, y: ty, k } = tf.current;
    const ink = css("--ink"), ink2 = css("--ink-2"), ink4 = css("--ink-4"), hue = css("--hue-knowledge"), bg = css("--bg");
    const near = active ? neighbours.get(active.id) ?? new Set() : null;
    const lit = (n: GNode) => !active || n === active || near!.has(n.id);
    const f = filter.trim().toLowerCase();
    g.lineWidth = 1;
    for (const l of graph.links) {
      const on = !active || l.source === active || l.target === active;
      g.globalAlpha = on ? (active ? 0.7 : 0.22) : 0.04;
      g.strokeStyle = on && active ? hue : ink4;
      g.beginPath(); g.moveTo(l.source.x * k + tx, l.source.y * k + ty); g.lineTo(l.target.x * k + tx, l.target.y * k + ty); g.stroke();
    }
    g.textAlign = "center";
    for (const n of graph.nodes) {
      const x = n.x! * k + tx, y = n.y! * k + ty, r = n.size * Math.max(0.7, Math.min(1.4, k));
      const match = f && n.label.toLowerCase().includes(f);
      g.globalAlpha = lit(n) ? 1 : 0.13;
      g.beginPath();
      if (n.type === "term") { g.arc(x, y, r, 0, 7); g.fillStyle = bg; g.fill(); g.lineWidth = 1.3; g.strokeStyle = match ? ink : hue; g.stroke(); }
      else if (n.type === "file") { g.arc(x, y, r + (n.fileId === selected ? 2 : 0), 0, 7); g.fillStyle = n.color; g.fill(); if (n.fileId === selected || match) { g.lineWidth = 2; g.strokeStyle = ink; g.stroke(); } }
      else { g.arc(x, y, r, 0, 7); g.fillStyle = n.color; g.globalAlpha *= 0.22; g.fill(); g.globalAlpha = lit(n) ? 1 : 0.13; g.lineWidth = 1.6; g.strokeStyle = n.color; g.stroke(); }
      const showLabel = n.type !== "file" ? k > 0.45 || n.type !== "term" : (active && lit(n)) || match || k > 1.5;
      if (showLabel && lit(n)) {
        g.font = n.type === "file" ? `400 10.5px ${css("--font-ui")}` : n.type === "term" ? `500 ${10 + Math.min(3, n.size / 4)}px ${css("--font-ui")}` : `600 12px ${css("--font-ui")}`;
        g.fillStyle = n.type === "file" ? ink2 : ink;
        g.fillText(n.label.length > 34 ? n.label.slice(0, 32) + "…" : n.label, x, y + r + 13);
      }
    }
    g.globalAlpha = 1;
  };
  useEffect(draw);

  const pick = (e: React.MouseEvent) => {
    if (!graph) return null;
    const rect = canvas.current!.getBoundingClientRect(), { x: tx, y: ty, k } = tf.current;
    const px = (e.clientX - rect.left - tx) / k, py = (e.clientY - rect.top - ty) / k;
    let best: GNode | null = null, bd = Infinity;
    for (const n of graph.nodes) { const d = Math.hypot(n.x! - px, n.y! - py); if (d < n.size + 7 / k && d < bd) { best = n; bd = d; } }
    return best;
  };

  if (!ids.length) return <Empty icon="knowledge" title="No files in this view">The knowledge map draws the files you are looking at and what connects them.</Empty>;
  if (graph && graph.nodes.length === 0) return <Empty icon="knowledge" title="No connections found yet">Files appear here when they share key terms with other files, or once you connect them to a course, a project or a tag. Files without readable text (images, video) join the map through tags and links.</Empty>;
  const pinnedFiles = pinned ? graph?.nodes.filter((n) => n.type === "file" && neighbours.get(pinned.id)?.has(n.id)) ?? [] : [];
  return (
    <div ref={ref} style={{ position: "relative", flex: 1, minHeight: 0, overflow: "hidden" }}>
      <canvas ref={canvas} style={{ width: "100%", height: "100%", cursor: hover ? "pointer" : dragging.current ? "grabbing" : "grab" }}
        onWheel={(e) => { const rect = canvas.current!.getBoundingClientRect(), t = tf.current, f2 = Math.exp(-e.deltaY * 0.0015), k = Math.max(0.2, Math.min(4, t.k * f2)); const mx = e.clientX - rect.left, my = e.clientY - rect.top; t.x = mx - ((mx - t.x) / t.k) * k; t.y = my - ((my - t.y) / t.k) * k; t.k = k; draw(); }}
        onMouseDown={(e) => { dragging.current = { x: e.clientX, y: e.clientY, moved: false }; }}
        onMouseMove={(e) => { const d = dragging.current; if (d) { tf.current.x += e.clientX - d.x; tf.current.y += e.clientY - d.y; if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) > 2) d.moved = true; d.x = e.clientX; d.y = e.clientY; draw(); } else { const n = pick(e); if (n !== hover) setHover(n); } }}
        onMouseUp={(e) => { const d = dragging.current; dragging.current = null; if (d?.moved) return; const n = pick(e); if (!n) setPinned(null); else if (n.type === "file") onSelect(n.fileId!); else setPinned(pinned === n ? null : n); }}
        onMouseLeave={() => { dragging.current = null; setHover(null); }} />
      <div className="row gap3" style={{ position: "absolute", left: 18, top: 12 }}>
        <input className="input" style={{ width: 200, height: 30 }} value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Highlight in map…" />
        <span className="small faint">{graph ? `${graph.shown} files · ${graph.nodes.filter((n) => n.type === "term").length} shared terms · ${graph.nodes.filter((n) => n.type !== "file" && n.type !== "term").length} links` : "Laying out…"}{fileIds.length > 500 ? " · first 500 files in view" : ""}</span>
      </div>
      <div className="row gap3 small faint" style={{ position: "absolute", left: 18, bottom: "calc(var(--dock-h) + 22px)" }}>
        <span className="row gap1"><i style={{ width: 9, height: 9, borderRadius: "50%", border: "1.3px solid var(--hue-knowledge)" }} />shared term</span>
        <span className="row gap1"><i className="dot" style={{ "--c": "#8FB4FF" } as any} />file</span>
        <span className="row gap1"><i style={{ width: 11, height: 11, borderRadius: "50%", border: "1.6px solid var(--hue-academy)", background: "color-mix(in srgb, var(--hue-academy) 22%, transparent)" }} />course / project / tag</span>
        <span>Scroll to zoom · drag to move · click a term to pin it</span>
      </div>
      {pinned && (
        <div className="plate glass col gap1" style={{ position: "absolute", right: 16, top: 12, width: 260, padding: 14, maxHeight: "70%" }}>
          <div className="row between"><span className="label">{pinned.type}</span><button className="icon-btn sm" onClick={() => setPinned(null)} aria-label="Unpin"><Icon name="x" size={12} /></button></div>
          <b>{pinned.label}</b>
          <span className="small faint">{pinned.type === "term" ? `Appears as a key term in ${plural(pinnedFiles.length, "file")} shown here.` : `${plural(pinnedFiles.length, "file")} connected.`}</span>
          <div className="scroll" style={{ margin: "4px -6px 0" }}>{pinnedFiles.map((n) => <button key={n.id} className="list-row small" style={{ width: "100%", textAlign: "left", padding: "5px 6px" }} onClick={() => onSelect(n.fileId!)}><i className="dot" style={{ "--c": n.color } as any} /><span className="truncate">{n.label}</span></button>)}</div>
          {pinned.type === "term" && <button className="btn sm" onClick={() => onSearch(pinned.label)}><Icon name="search" size={12} />Search everything for “{pinned.label}”</button>}
        </div>
      )}
    </div>
  );
}
