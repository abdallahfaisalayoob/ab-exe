import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useUI, WORLDS, World } from "./lib/store";
import { useSettings, useSetting } from "./lib/hooks";
import { isTauri, native } from "./lib/backend";
import { captureClipboard, checkReminders, rescan, useJobs, watchJobs } from "./lib/actions";
import { seedPrompts } from "./lib/prompts";
import { Icon } from "./ui/Icons";
import { Palette } from "./shell/Palette";
import { ActivityCenter, DropZone, Settings, Toasts } from "./shell/Overlays";
import { Handoff } from "./shell/Handoff";
import { QuickAdd } from "./shell/QuickAdd";
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
        <button className={"icon-btn" + (activity ? " on" : "")} onClick={() => set({ activity: !activity })} title="Activity & insights" aria-label="Activity and insights"><Icon name="bell" size={17} /></button>
        <button className="icon-btn" onClick={() => set({ settings: true })} title="Settings (Ctrl ,)" aria-label="Settings"><Icon name="gear" size={17} /></button>
        <button className="icon-btn" onClick={() => native.win("fullscreen")} title="Full screen (F11)" aria-label="Full screen"><Icon name="full" size={16} /></button>
        {isTauri && <>
          <span style={{ width: 8 }} />
          <button className="win-btn" onClick={() => native.win("minimize")} aria-label="Minimise"><Icon name="min" size={14} /></button>
          <button className="win-btn" onClick={() => native.win("maximize")} aria-label="Maximise"><Icon name="max" size={12} /></button>
          <button className="win-btn close" onClick={() => native.win("close")} aria-label="Close"><Icon name="x" size={14} /></button>
        </>}
      </div>
    </header>
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
  const { world, go, set, palette, settings, activity, handoff, quick } = useUI();
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
        void watchJobs();
        void rescan().catch(() => {});
        void checkReminders();
      } catch (e: any) { setBootError(String(e?.message ?? e)); }
    })();
    const minute = setInterval(() => void checkReminders().catch(() => {}), 60_000);
    const watch = setInterval(() => void rescan().catch(() => {}), 10 * 60_000);
    return () => { clearInterval(minute); clearInterval(watch); };
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
      else if (e.key === "F11") { e.preventDefault(); void native.win("fullscreen"); }
      else if (e.key === "Escape") set({ palette: false, activity: false });
    };
    window.addEventListener("keydown", onKey);
    const noMenu = (e: MouseEvent) => { if (isTauri && !(e.target as HTMLElement).closest("input, textarea, .selectable")) e.preventDefault(); };
    window.addEventListener("contextmenu", noMenu);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("contextmenu", noMenu); };
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
      <DropZone />
      <Toasts />
    </div>
  );
}
