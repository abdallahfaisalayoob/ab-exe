import { useEffect, useRef, useState } from "react";
import { call, isTauri, native, q, run } from "../lib/backend";
import { findPlace, speak, type Place } from "../lib/orion";
import { importPaths, useJobs } from "../lib/actions";
import { ago } from "../lib/dates";
import { bytes } from "../lib/format";
import { useQ, useRows, useSetting } from "../lib/hooks";
import { computeInsights } from "../lib/insights";
import { DEFAULT_RULES } from "../lib/workload";
import { attempt, useUI, World } from "../lib/store";
import { hm, parseHm } from "../lib/dates";
import { Icon } from "../ui/Icons";
import { Confirm, Empty, Field, Modal, Seg, Toggle } from "../ui/kit";

export function Toasts() {
  const toasts = useUI((s) => s.toasts);
  const dismiss = useUI((s) => s.dismiss);
  return (
    <div className="toasts" role="status">
      {toasts.map((t) => (
        <div key={t.id} className={"toast " + (t.kind ?? "")}>
          <Icon name={t.kind === "error" ? "warn" : t.kind === "good" ? "check" : "info"} size={15} style={{ color: t.kind === "error" ? "var(--bad)" : t.kind === "good" ? "var(--good)" : "var(--hue)", marginTop: 1, flex: "none" }} />
          <span className="grow selectable">{t.text}</span>
          {t.action && <button className="btn sm" onClick={() => { t.action!.run(); dismiss(t.id); }}>{t.action.label}</button>}
          <button className="icon-btn sm" onClick={() => dismiss(t.id)} aria-label="Dismiss"><Icon name="x" size={12} /></button>
        </div>
      ))}
    </div>
  );
}

/** The universal drop zone: drop anywhere, choose where it lands. Originals stay put. */
export function DropZone() {
  const [state, setState] = useState<{ side: "library" | "inbox" } | null>(null);
  useEffect(() => {
    let off: (() => void) | undefined;
    native.onDrop((e) => {
      const side = (e.x ?? 0) > window.innerWidth / 2 ? "inbox" : "library";
      if (e.type === "enter" || e.type === "over") setState({ side });
      else if (e.type === "leave") setState(null);
      else if (e.type === "drop") {
        setState(null);
        if (e.paths?.length) {
          void importPaths(e.paths, { inbox: side === "inbox" });
          useUI.getState().go("knowledge", side === "inbox" ? { tab: "inbox" } : undefined);
        }
      }
    }).then((f) => { off = f; });
    return () => off?.();
  }, []);
  if (!state) return null;
  return (
    <div className="dropzone">
      <div className={"target" + (state.side === "library" ? " hot" : "")} style={{ "--c": "var(--hue-knowledge)" } as any}>
        <Icon name="knowledge" size={44} stroke={1.1} />
        <h2 className="display">Add to Knowledge</h2>
        <p className="dim" style={{ maxWidth: 340 }}>Folders become collections and are indexed where they are. Nothing is moved or copied.</p>
      </div>
      <div className={"target" + (state.side === "inbox" ? " hot" : "")} style={{ "--c": "var(--hue-home)" } as any}>
        <Icon name="inbox" size={44} stroke={1.1} />
        <h2 className="display">Send to Inbox</h2>
        <p className="dim" style={{ maxWidth: 340 }}>For loose downloads and screenshots you want to review and file later.</p>
      </div>
    </div>
  );
}

export function ActivityCenter() {
  const go = useUI((s) => s.go);
  const [tab, setTab] = useState<"insights" | "activity">("insights");
  const insights = useQ(() => computeInsights(), []).data;
  const activity = useRows<any>("SELECT * FROM activity ORDER BY ts DESC LIMIT 60");
  const jobs = useJobs((s) => s.jobs);
  return (
    <aside className="drawer" aria-label="Activity and insights">
      <div className="row between" style={{ padding: "18px 20px 10px" }}>
        <h2 className="display" style={{ fontSize: 26 }}>Signals</h2>
        <Seg value={tab} onChange={setTab} options={[{ value: "insights", label: "Insights" }, { value: "activity", label: "Activity" }]} />
      </div>
      <div className="scroll grow" style={{ padding: "4px 12px 110px" }}>
        {jobs.filter((j) => !j.finished_at).map((j) => (
          <div key={j.id} className="plate pad" style={{ padding: 14, marginBottom: 8 }}>
            <div className="row between"><span className="row"><Icon name="orbit" size={14} className="spin hue" /> {j.label}</span><button className="btn sm ghost" onClick={() => call("jobs.cancel", { id: j.id })}>Stop</button></div>
            <div className="bar" style={{ margin: "10px 0 6px" }}><i style={{ width: j.total ? `${(j.done / j.total) * 100}%` : "8%" }} /></div>
            <div className="small faint truncate">{j.state === "scanning" ? `Scanning… ${j.total} files found` : `${j.done} of ${j.total} · ${j.current}`}</div>
          </div>
        ))}
        {tab === "insights" ? (
          !insights ? null : insights.length === 0 ? <Empty icon="spark" title="All quiet">Insights appear here when something in your data deserves attention — a crowded week, a missing file, an unusual month.</Empty> : (
            <div className="col stagger">
              {insights.map((i) => (
                <button key={i.id} className="plate hover" style={{ padding: "13px 14px", textAlign: "left", "--hue": `var(--hue-${i.world})` } as any} onClick={() => go(i.world as World, { tab: i.tab })}>
                  <div className="row" style={{ alignItems: "flex-start", gap: 10 }}>
                    <span className="dot" style={{ marginTop: 7, "--c": i.tone === "warn" ? "var(--warn)" : `var(--hue-${i.world})` } as any} />
                    <div className="col gap1 grow"><span>{i.title}</span><span className="small faint">{i.why}</span></div>
                  </div>
                </button>
              ))}
              <p className="small faint" style={{ padding: "8px 6px" }}>Each insight is a fixed rule applied to your own data, shown with its reasoning. Nothing leaves this computer.</p>
            </div>
          )
        ) : activity.length === 0 ? <Empty icon="archive" title="No activity yet">What you do here is recorded locally so the Archive can show how your universe evolves.</Empty> : (
          activity.map((a) => (
            <div key={a.id} className="list-row" style={{ alignItems: "flex-start" }}>
              <span className="dot" style={{ marginTop: 7, "--c": `var(--hue-${a.world})` } as any} />
              <div className="col grow" style={{ gap: 1 }}><span className="truncate">{a.title}</span>{a.detail && <span className="small faint truncate">{a.detail}</span>}</div>
              <span className="small faint" style={{ whiteSpace: "nowrap" }}>{ago(a.ts)}</span>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}

const SHORTCUTS: [string, string][] = [["Ctrl K", "Command bar"], ["Ctrl 1–7", "Switch world"], ["Ctrl D", "New deadline"], ["Ctrl E", "New transaction"], ["Ctrl ⇧ V", "Capture clipboard"], ["Ctrl ,", "Settings"], ["F11", "Full screen"], ["Esc", "Close panel"]];

export function Settings() {
  const close = () => useUI.getState().set({ settings: false });
  const go = useUI((s) => s.go);
  const [theme, setTheme] = useSetting("theme", "midnight");
  const [calm, setCalm] = useSetting("calm", false);
  const [resume, setResume] = useSetting("resume", false);
  const [notifications, setNotifications] = useSetting("notifications", true);
  const [currency, setCurrency] = useSetting("currency", "PKR");
  const [usdRate, setUsdRate] = useSetting("usdRate", 0);
  const [rules, setRules] = useSetting("studyRules", DEFAULT_RULES);
  const r = { ...DEFAULT_RULES, ...rules };
  const [oMode, setOMode] = useSetting("orion.mode", "always");
  const [oVoice, setOVoice] = useSetting("orion.voice", true);
  const [oAddress, setOAddress] = useSetting("orion.address", "sir");
  const [oWeather, setOWeather] = useSetting("orion.weather", false);
  const [oPlace, setOPlace] = useSetting<Place | null>("orion.place", null);
  const [city, setCity] = useState("");
  const enableWeather = () => attempt(async () => {
    const p = await findPlace(city.trim() || oPlace?.name || "");
    if (!p) throw new Error("That place was not found. Try the city name on its own.");
    setOPlace(p); setOWeather(true); setCity("");
    await run("INSERT INTO outbound_log(ts, target, summary, files) VALUES(?, 'open-meteo.com', ?, '[]')", [Date.now(), `Weather switched on for ${p.name}. Each briefing now requests a forecast for coordinates ${p.lat}, ${p.lon} from open-meteo.com. No personal data is included.`]);
  }, "Weather is on.");
  const [oNatural, setONatural] = useSetting("orion.natural", false);
  const [oNatVoice, setONatVoice] = useSetting<string | null>("orion.naturalVoice", null);
  const [pickVoice, setPickVoice] = useState("en_GB-alan-medium");
  const [vs, setVs] = useState<any>(null);
  useEffect(() => {
    let live = true, timer: any;
    const poll = async () => {
      const s = await call<any>("voice.status").catch(() => null);
      if (!live) return;
      setVs((old: any) => {
        // A finished download switches the natural voice on and lets it introduce itself.
        if (old?.job.state === "downloading" && s?.job.state === "ready") { const v = s.voices.find((x: any) => x.id === pickVoiceRef.current && x.installed); if (v) { setONatural(true); setONatVoice(v.id); setTimeout(() => void speak("Natural voice installed. Rather better, wouldn't you say?", v.id), 300); } }
        return s;
      });
      if (s?.job.state === "downloading") timer = setTimeout(poll, 500);
    };
    void poll();
    pollRef.current = poll;
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line
  }, []);
  const pollRef = useRef<() => void>(() => {});
  const pickVoiceRef = useRef(pickVoice); pickVoiceRef.current = pickVoice;
  const chosen = vs?.voices.find((v: any) => v.id === pickVoice);
  const getVoice = () => attempt(async () => {
    if (chosen?.installed) { setONatural(true); setONatVoice(pickVoice); void speak("At your service.", pickVoice); return; }
    await call("voice.install", { voice: pickVoice });
    pollRef.current();
  });
  const [auto, setAuto] = useState<boolean | null>(null);
  const info = useQ(() => call<any>("app.info"), []).data;
  const counts = useQ(() => q<any>("SELECT (SELECT COUNT(*) FROM files) files, (SELECT COUNT(*) FROM outbound_log) outbound"), []).data?.[0];
  useEffect(() => { native.autostart().then(setAuto).catch(() => setAuto(null)); }, []);
  const Row = ({ title, sub, children }: { title: string; sub?: string; children: React.ReactNode }) => (
    <div className="row between gap4" style={{ padding: "10px 0" }}><div className="col" style={{ gap: 1 }}><span>{title}</span>{sub && <span className="small faint">{sub}</span>}</div>{children}</div>
  );
  return (
    <Modal title="Settings" sub="Everything here is stored on this computer." onClose={close} wide>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 36 }}>
        <div className="col gap1">
          <span className="label">Appearance</span>
          <Row title="Theme"><Seg value={theme} onChange={setTheme} options={[{ value: "midnight", label: "Midnight" }, { value: "graphite", label: "Graphite" }, { value: "daylight", label: "Daylight" }]} /></Row>
          <Row title="Calm mode" sub="Stops the slow atmospheric motion"><Toggle on={calm} onChange={setCalm} label="Calm mode" /></Row>
          <hr className="hr" style={{ margin: "8px 0 12px" }} /><span className="label">Start-up</span>
          <Row title="Resume where I left off" sub="Open the last world instead of Home"><Toggle on={resume} onChange={setResume} label="Resume last world" /></Row>
          <Row title="Launch when Windows starts" sub={auto === null ? "Available in the installed desktop app" : undefined}>{auto === null ? <span className="chip">desktop only</span> : <Toggle on={auto} onChange={(v) => attempt(async () => setAuto(await native.autostart(v)))} label="Launch on startup" />}</Row>
          <Row title="Deadline reminders" sub="Windows notifications 24 hours and 1 hour before"><Toggle on={notifications} onChange={(v) => { setNotifications(v); if (v) void native.notify("Reminders are on", "You will be notified before deadlines."); }} label="Reminders" /></Row>
          <hr className="hr" style={{ margin: "8px 0 12px" }} /><span className="label">O.R.I.O.N. — your launch briefing</span>
          <Row title="Greet me"><Seg value={oMode} onChange={setOMode} options={[{ value: "always", label: "Every launch" }, { value: "daily", label: "Once a day" }, { value: "off", label: "Never" }]} /></Row>
          <Row title="Speak the briefing" sub="Always spoken on this computer — no online speech"><Toggle on={oVoice} onChange={setOVoice} label="ORION voice" /></Row>
          <div className="col gap1" style={{ padding: "10px 0" }}>
            <div className="row between gap4"><div className="col" style={{ gap: 1 }}><span>Natural voice</span><span className="small faint">{oNatural && oNatVoice ? `On — ${vs?.voices.find((v: any) => v.id === oNatVoice)?.label ?? oNatVoice}. Generated on this computer; works offline.` : "A neural voice that runs on this computer. One-time download, then fully offline."}</span></div>
              {oNatural && <button className="btn sm" onClick={() => setONatural(false)}>Use Windows voice</button>}</div>
            {vs && vs.job.state === "downloading" ? (
              <div className="col gap1"><div className="bar"><i style={{ width: `${Math.min(100, (vs.job.done / Math.max(1, vs.job.total)) * 100)}%` }} /></div><span className="small faint">{vs.job.label} · {bytes(vs.job.done)} of {bytes(vs.job.total)}</span></div>
            ) : vs && (
              <div className="row gap1 wrap">
                <select className="select" style={{ width: 250, height: 30 }} value={pickVoice} onChange={(e) => setPickVoice(e.target.value)} aria-label="Natural voice">{vs.voices.map((v: any) => <option key={v.id} value={v.id}>{v.label}{v.installed ? " ✓" : ""}</option>)}</select>
                <button className="btn sm primary" onClick={getVoice}>{chosen?.installed ? (oNatural && oNatVoice === pickVoice ? "Preview" : "Use this voice") : `Download · ${bytes((chosen?.size ?? 0) + (vs.engine ? 0 : vs.engineSize))}`}</button>
                {vs.engine && <Confirm className="btn sm ghost" label="Remove voices" onConfirm={() => attempt(async () => { setONatural(false); setVs(await call("voice.remove")); })} />}
              </div>
            )}
            {vs?.job.state === "error" && <span className="small bad">{vs.job.error}</span>}
            {vs && !vs.engine && vs.job.state !== "downloading" && <span className="faint" style={{ fontSize: 11 }}>Downloads from {vs.sources.join(" and ")}; each file is verified before use. Nothing of yours is sent.</span>}
          </div>
          <Row title="Call me"><input className="input" style={{ width: 150 }} value={oAddress} onChange={(e) => setOAddress(e.target.value)} placeholder="sir, boss, your name…" /></Row>
          <Row title="Weather" sub={oWeather && oPlace ? `On for ${oPlace.name}. The only online request the app makes: coordinates → open-meteo.com.` : "Off. Needs the internet: your city's coordinates are sent to open-meteo.com."}>
            {oWeather ? <button className="btn sm" onClick={() => setOWeather(false)}>Turn off</button> : <div className="row gap1"><input className="input" style={{ width: 120 }} value={city} onChange={(e) => setCity(e.target.value)} onKeyDown={(e) => e.key === "Enter" && enableWeather()} placeholder={oPlace?.name ?? "City"} /><button className="btn sm" onClick={enableWeather} disabled={!city.trim() && !oPlace}>Turn on</button></div>}
          </Row>
          <hr className="hr" style={{ margin: "8px 0 12px" }} /><span className="label">Study rules — used by the workload planner</span>
          <div className="grid3" style={{ paddingTop: 8 }}>
            <Field label="Study budget / day (h)"><input className="input" type="number" min="0" max="16" step="0.5" value={r.studyPerDay} onChange={(e) => setRules({ ...r, studyPerDay: +e.target.value || 0 })} /></Field>
            <Field label="Day starts"><input className="input" type="time" value={hm(r.dayStart)} onChange={(e) => setRules({ ...r, dayStart: parseHm(e.target.value) })} /></Field>
            <Field label="Day ends"><input className="input" type="time" value={hm(r.dayEnd)} onChange={(e) => setRules({ ...r, dayEnd: parseHm(e.target.value) })} /></Field>
          </div>
        </div>
        <div className="col gap1">
          <span className="label">Money</span>
          <Row title="Display currency" sub="Totals are shown in this currency"><Seg value={currency} onChange={setCurrency} options={[{ value: "PKR", label: "PKR" }, { value: "USD", label: "USD" }]} /></Row>
          <Row title="USD → PKR rate" sub={usdRate ? "Entered by you. No online rate source is contacted." : "Not set — amounts in the other currency are left out of totals until you enter one."}>
            <input className="input num" style={{ width: 110 }} type="number" min="0" step="0.01" value={usdRate || ""} placeholder="e.g. 280" onChange={(e) => setUsdRate(+e.target.value || 0)} />
          </Row>
          <hr className="hr" style={{ margin: "8px 0 12px" }} /><span className="label">Privacy</span>
          <p className="small dim" style={{ padding: "8px 0" }}>No telemetry, no accounts, no cloud. Only three things can reach the internet, each started by you: an AI handoff you confirm, the optional weather line in ORION’s briefing, and the one-time download of ORION’s natural voice. All are written to the privacy ledger ({counts?.outbound ?? 0} so far).</p>
          <div className="row"><button className="btn sm" onClick={() => { close(); go("archive", { tab: "privacy" }); }}><Icon name="shield" size={14} />Privacy ledger</button><button className="btn sm" onClick={() => { close(); go("archive", { tab: "backups" }); }}><Icon name="download" size={14} />Backups & export</button></div>
          <hr className="hr" style={{ margin: "14px 0 12px" }} /><span className="label">Data on this computer</span>
          <div className="col gap1 small" style={{ padding: "8px 0" }}>
            <span className="dim selectable mono" style={{ wordBreak: "break-all" }}>{info?.dataDir}</span>
            <span className="faint">Database {bytes(info?.dbSize ?? 0)} · {counts?.files ?? 0} files indexed · version {info?.version}{isTauri ? "" : " · development bridge"}</span>
          </div>
          {isTauri && <div className="row"><button className="btn sm" onClick={() => attempt(() => native.openPath(info.dataDir))}><Icon name="folder" size={14} />Open data folder</button></div>}
          <hr className="hr" style={{ margin: "14px 0 12px" }} /><span className="label">Keyboard</span>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 18px", paddingTop: 8 }}>{SHORTCUTS.map(([k, v]) => <div key={k} className="row between small"><span className="dim">{v}</span><span className="kbd">{k}</span></div>)}</div>
        </div>
      </div>
    </Modal>
  );
}

export function Ask() {
  const a = useUI((s) => s.ask)!;
  const [v, setV] = useState(a.value);
  const done = (r: string | null) => { useUI.setState({ ask: null }); a.resolve(r); };
  return (
    <Modal title={a.title} onClose={() => done(null)} foot={<><button className="btn ghost" onClick={() => done(null)}>Cancel</button><button className="btn primary" onClick={() => done(v)}>OK</button></>}>
      <input className="input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done(v)} onFocus={(e) => e.target.select()} />
    </Modal>
  );
}
