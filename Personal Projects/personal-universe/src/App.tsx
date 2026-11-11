import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useUI, WORLDS, World } from "./lib/store";
import { useCourseFocus, useSettings, useSetting } from "./lib/hooks";
import { startListening, stopListening } from "./lib/listen";
import { call, isTauri, native } from "./lib/backend";
import { captureClipboard, checkReminders, requestClose, rescan, useJobs, wantsWrap, watchJobs } from "./lib/actions";
import { seedPrompts } from "./lib/prompts";
import { Icon } from "./ui/Icons";
import { Palette } from "./shell/Palette";
import { ActivityCenter, Ask, DropZone, Settings, Toasts } from "./shell/Overlays";
import { Handoff } from "./shell/Handoff";
import { QuickAdd } from "./shell/QuickAdd";
import { FocusChip, Orion } from "./shell/Orion";
import { StudyChip, StudyPanel } from "./shell/Study";
import Home from "./worlds/Home";

const Knowledge = lazy(() => import("./worlds/Knowledge"));
const Academy = lazy(() => import("./worlds/Academy"));
const Finance = lazy(() => import("./worlds/Finance"));
const Projects = lazy(() => import("./worlds/Projects"));
const Archive = lazy(() => import("./worlds/Archive"));
const Tools = lazy(() => import("./worlds/Tools"));
const VIEW: Record<World, React.ComponentType> = { home: Home, knowledge: Knowledge, academy: Academy, finance: Finance, projects: Projects, archive: Archive, tools: Tools };

function Atmosphere() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const draw = () => {
      const c = ref.current;
      if (!c) return;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      c.width = innerWidth * dpr; c.height = innerHeight * dpr;
      const g = c.getContext("2d")!;
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      for (let i = 0; i < 260; i++) {
        const x = rnd() * c.width, y = rnd() * c.height, m = rnd();
        g.globalAlpha = 0.12 + m * m * 0.6;
        g.fillStyle = m > 0.92 ? "#FFE9C2" : m > 0.8 ? "#CFE4FF" : "#FFFFFF";
        g.beginPath(); g.arc(x, y, (0.35 + m * m * 1.1) * dpr, 0, 6.3); g.fill();
      }
    };
    draw();
    window.addEventListener("resize", draw);
    return () => window.removeEventListener("resize", draw);
  }, []);
  return <div className="atmosphere"><canvas ref={ref} /><div className="glow a" /><div className="glow b" /><div className="grain" /></div>;
}

function TopBar() {
  const world = useUI((s) => s.world);
  const set = useUI((s) => s.set);
  const activity = useUI((s) => s.activity);
  const jobs = useJobs((s) => s.jobs);
  const active = jobs.filter((j) => !j.finished_at);
  const total = active.reduce((n, j) => n + j.total, 0), done = active.reduce((n, j) => n + j.done, 0);
  const listening = useUI((s) => s.listening);
  const [focus, setFocus] = useCourseFocus();
  return (
    <header className="topbar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <svg width="18" height="18" viewBox="0 0 24 24" style={{ pointerEvents: "none" }}><circle cx="12" cy="12" r="3.4" fill="var(--hue-home)" /><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(-28 12 12)" fill="none" stroke="var(--hue)" strokeWidth="1.3" style={{ transition: "stroke var(--med)" }} /></svg>
        <b style={{ pointerEvents: "none" }}>Personal Universe</b>
        <span className="faint" style={{ pointerEvents: "none" }}>/</span>
        <span className="crumb" style={{ pointerEvents: "none" }}>{WORLDS.find((w) => w.id === world)!.name}</span>
      </div>
      <button className="cmd-trigger" onClick={() => set({ palette: true })} aria-label="Open the command bar">
        <Icon name="search" size={14} /><span className="grow truncate" style={{ textAlign: "left" }}>Search or tell your universe what to do…</span><span className="kbd">Ctrl K</span>
      </button>
      <div className="right" data-tauri-drag-region>
        {active.length > 0 && (
          <span className="chip tint" title={active.map((j) => `${j.label}: ${j.current}`).join("\n")}>
            <Icon name="orbit" size={12} className="spin" />{active[0].state === "queued" ? "Queued…" : active[0].state === "scanning" ? "Scanning…" : `Indexing ${done}/${total}`}
          </span>
        )}
        {focus && <span className="chip tint" style={{ "--c": focus.color, height: 26 } as any} title="The app is focused on this course"><Icon name="target" size={12} /><span className="truncate" style={{ maxWidth: 150 }}>{focus.name}</span><button onClick={() => setFocus(null)} aria-label="Leave course focus"><Icon name="x" size={10} /></button></span>}
        <StudyChip />
        <FocusChip />
        <button className={"icon-btn" + (listening !== "off" ? " on" : "")} onClick={() => (listening === "recording" ? stopListening() : startListening())} title="Talk to ORION — hold Ctrl + Space, or click to start and stop" aria-label="Talk to ORION"><Icon name="mic" size={17} className={listening === "thinking" ? "pulse" : ""} /></button>
        <button className="icon-btn" onClick={() => set({ orion: "brief" })} title="ORION briefing" aria-label="ORION briefing"><Icon name="orbit" size={17} /></button>
        <button className={"icon-btn" + (activity ? " on" : "")} onClick={() => set({ activity: !activity })} title="Activity & insights" aria-label="Activity and insights"><Icon name="bell" size={17} /></button>
        <button className="icon-btn" onClick={() => set({ settings: true })} title="Settings (Ctrl ,)" aria-label="Settings"><Icon name="gear" size={17} /></button>
        <button className="icon-btn" onClick={() => native.win("fullscreen")} title="Full screen (F11)" aria-label="Full screen"><Icon name="full" size={16} /></button>
        {isTauri && <>
          <span style={{ width: 8 }} />
          <button className="win-btn" onClick={() => native.win("minimize")} aria-label="Minimise"><Icon name="min" size={14} /></button>
          <button className="win-btn" onClick={() => native.win("maximize")} aria-label="Maximise"><Icon name="max" size={12} /></button>
          <button className="win-btn close" onClick={requestClose} aria-label="Close"><Icon name="x" size={14} /></button>
        </>}
      </div>
    </header>
  );
}

function ListeningPill() {
  const state = useUI((s) => s.listening);
  if (state === "off") return null;
  return (
    <div style={{ position: "fixed", left: "50%", top: 64, transform: "translateX(-50%)", zIndex: 260, pointerEvents: "none" }}>
      <div className="plate row gap3" style={{ background: "var(--panel)", padding: "10px 18px", borderRadius: 999, borderColor: "var(--hue-home)", boxShadow: "var(--shadow), 0 0 60px -18px var(--hue-home)", animation: "rise var(--fast) var(--ease) both" }}>
        <span style={{ width: 10, height: 10, borderRadius: "50%", background: state === "recording" ? "var(--bad)" : "var(--hue-home)" }} className="pulse" />
        <span>{state === "recording" ? "Listening… let go when you are done" : "Understanding…"}</span>
      </div>
    </div>
  );
}

function Dock() {
  const world = useUI((s) => s.world);
  const go = useUI((s) => s.go);
  return (
    <div className="dock-wrap">
      <nav className="dock" aria-label="Worlds">
        {WORLDS.map((w, i) => (
          <button key={w.id} className={"dock-item" + (world === w.id ? " on" : "")} style={{ "--h": `var(--hue-${w.id})` } as any} onClick={() => go(w.id)} title={`${w.name} — ${w.blurb} (Ctrl ${i + 1})`} aria-current={world === w.id}>
            <Icon name={w.id} size={20} stroke={1.4} /><span className="name">{w.name}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

export default function App() {
  const { world, go, set, palette, settings, activity, handoff, quick, ask, orion } = useUI();
  const loaded = useSettings((s) => s.loaded);
  const [bootError, setBootError] = useState<string | null>(null);
  const [theme] = useSetting("theme", "midnight");
  const [calm] = useSetting("calm", false);
  const [lastWorld, setLastWorld] = useSetting<World>("lastWorld", "home");

  useEffect(() => {
    (async () => {
      try {
        await useSettings.getState().load();
        const v = useSettings.getState().values;
        if (v.resume && v.lastWorld) useUI.setState({ world: v.lastWorld });
        await seedPrompts();
        // ORION greets you on launch (every launch, once a day, or never — your choice in Settings).
        const mode = v["orion.mode"] ?? "always", day = new Date().toDateString();
        if (mode === "always" || (mode === "daily" && v["orion.lastDay"] !== day)) useUI.setState({ orion: "brief" });
        // First launch with text recognition available: read the images that were indexed before it existed.
        const info = await call<any>("app.info");
        if (info.ocr && !v["ocr.backfilled"]) { await useSettings.getState().put("ocr.backfilled", true); const r = await call<any>("files.reocr"); if (r.jobs?.length) void watchJobs(); }
        void useSettings.getState().put("orion.lastDay", day);
        void watchJobs();
        void rescan().catch(() => {});
        void checkReminders();
      } catch (e: any) { setBootError(String(e?.message ?? e)); }
    })();
    const minute = setInterval(() => void checkReminders().catch(() => {}), 60_000);
    const watch = setInterval(() => void rescan().catch(() => {}), 10 * 60_000);
    // Closing the window (button, Alt+F4, taskbar) passes through ORION's wrap-up when it is switched on.
    let offClose: (() => void) | undefined;
    native.onClose(() => { if (!wantsWrap()) return false; useUI.setState({ orion: "wrap", palette: false, settings: false }); return true; }).then((f) => { offClose = f; });
    return () => { clearInterval(minute); clearInterval(watch); offClose?.(); };
  }, []);

  useEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);
  useEffect(() => { if (loaded && world !== lastWorld) setLastWorld(world); /* eslint-disable-next-line */ }, [world, loaded]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); set({ palette: !useUI.getState().palette }); }
      else if (mod && e.key === ",") { e.preventDefault(); set({ settings: true }); }
      else if (mod && /^[1-7]$/.test(e.key)) { e.preventDefault(); go(WORLDS[+e.key - 1].id); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === "v") { e.preventDefault(); void captureClipboard(); }
      else if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); set({ quick: { type: "deadline" } }); }
      else if (mod && e.key.toLowerCase() === "e") { e.preventDefault(); set({ quick: { type: "tx" } }); }
      else if (mod && e.key.toLowerCase() === "p") { e.preventDefault(); set({ quick: { type: "study" } }); }
      else if (mod && e.code === "Space") { e.preventDefault(); if (!e.repeat) void startListening(); }
      else if (e.key === "F11") { e.preventDefault(); void native.win("fullscreen"); }
      else if (e.key === "Escape") set({ palette: false, activity: false });
    };
    const onUp = (e: KeyboardEvent) => { if ((e.code === "Space" || e.key === "Control") && useUI.getState().listening === "recording") void stopListening(); };
    window.addEventListener("keyup", onUp);
    window.addEventListener("keydown", onKey);
    const noMenu = (e: MouseEvent) => { if (isTauri && !(e.target as HTMLElement).closest("input, textarea, .selectable")) e.preventDefault(); };
    window.addEventListener("contextmenu", noMenu);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onUp); window.removeEventListener("contextmenu", noMenu); };
  }, [go, set]);

  const View = VIEW[world];
  return (
    <div data-world={world} className={calm ? "calm" : ""} style={{ height: "100%" }}>
      <Atmosphere />
      <div className="shell">
        <TopBar />
        <main className="stage">
          {bootError ? (
            <div className="empty" style={{ height: "100%" }}><div className="glyph"><Icon name="warn" size={26} /></div><h3>The local core could not be reached</h3><p className="small selectable">{bootError}</p><button className="btn" onClick={() => location.reload()}>Try again</button></div>
          ) : loaded ? (
            <Suspense fallback={null}><div className="world" key={world}><View /></div></Suspense>
          ) : null}
          <Dock />
          {activity && <ActivityCenter />}
        </main>
      </div>
      {palette && <Palette />}
      {settings && <Settings />}
      {handoff && <Handoff />}
      {quick && <QuickAdd />}
      {ask && <Ask />}
      {orion && <Orion />}
      <ListeningPill />
      {loaded && <StudyPanel />}
      <DropZone />
      <Toasts />
    </div>
  );
}
