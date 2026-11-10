// O.R.I.O.N. — the wake-up briefing and the evening wrap-up. Both are spoken, both are built
// only from your own data, and both get out of the way with one key.
import { useEffect, useState } from "react";
import { isTauri, log, native } from "../lib/backend";
import { useNow, useQ, useSetting } from "../lib/hooks";
import { canSpeak, compose, composeWrap, gather, gatherDay, getWeather, hush, isSpeaking, speak, type Line } from "../lib/orion";
import { toast, useUI } from "../lib/store";
import { Icon } from "../ui/Icons";

export function startFocus(title: string, minutes: number) {
  useUI.setState({ focus: { title, minutes, until: Date.now() + minutes * 60_000 } });
  void speak(`Focus protocol engaged. ${minutes} minutes on the clock.`);
  toast(`Focus block started — ${minutes} minutes on “${title}”.`, "good");
}

/** Lives in the top bar while a focus block runs. */
export function FocusChip() {
  const focus = useUI((s) => s.focus);
  const now = useNow(1000);
  useEffect(() => {
    if (!focus) return;
    const t = setTimeout(() => {
      useUI.setState({ focus: null });
      const msg = `Focus block complete: ${focus.minutes} minutes on ${focus.title}. Well done.`;
      void speak(msg); toast(msg, "good");
      void native.notify("Focus block complete", `${focus.minutes} minutes on ${focus.title}.`);
      void log("academy", "focus", `Focused for ${focus.minutes} minutes`, undefined, focus.title);
    }, Math.max(0, focus.until - Date.now()));
    return () => clearTimeout(t);
  }, [focus]);
  if (!focus) return null;
  const s = Math.max(0, Math.round((focus.until - now.getTime()) / 1000));
  return (
    <span className="chip tint" style={{ "--c": "var(--hue-home)", height: 26 } as any} title={focus.title}>
      <Icon name="clock" size={12} /><span className="mono num">{String(Math.floor(s / 60)).padStart(2, "0")}:{String(s % 60).padStart(2, "0")}</span><span className="truncate" style={{ maxWidth: 130 }}>{focus.title}</span>
      <button onClick={() => { useUI.setState({ focus: null }); hush(); }} aria-label="Stop focus block"><Icon name="x" size={10} /></button>
    </span>
  );
}

function Core({ speaking, calm }: { speaking: boolean; calm?: boolean }) {
  const k = calm ? 2.2 : 1;
  const ring = (r: number, dash: string, dur: number, w = 1.4, rev = false, o = 0.8) => <circle cx="160" cy="160" r={r} fill="none" stroke="var(--hue-home)" strokeWidth={w} strokeDasharray={dash} strokeLinecap="round" opacity={calm ? o * 0.6 : o} style={{ transformOrigin: "160px 160px", animation: `spin ${dur * k}s linear infinite ${rev ? "reverse" : ""}` }} />;
  return (
    <svg viewBox="0 0 320 320" style={{ width: "min(34vw, 380px)", flex: "none", overflow: "visible" }} aria-hidden>
      <defs><radialGradient id="orion-core"><stop offset="0" stopColor="#FFF4D8" /><stop offset=".45" stopColor="var(--hue-home)" /><stop offset="1" stopColor="var(--hue-home)" stopOpacity="0" /></radialGradient></defs>
      <circle cx="160" cy="160" r="150" fill="none" stroke="var(--line)" />
      {ring(150, "2 14", 90, 1.2, false, 0.5)}{ring(128, "120 60 20 60", 26, 1.6, true)}{ring(106, "6 10", 40, 2.4, false, 0.55)}{ring(84, "200 80", 14, 1.4)}{ring(62, "30 22", 20, 3, true, 0.7)}
      <circle cx="160" cy="160" r="46" fill="url(#orion-core)" style={{ transformOrigin: "160px 160px", animation: speaking ? "orion-talk .55s ease-in-out infinite alternate" : "orion-breathe 3.4s ease-in-out infinite alternate" }} />
      <circle cx="160" cy="160" r="15" fill="#FFF8E6" />
      {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <line key={i} x1={160 + Math.cos(a) * 138} y1={160 + Math.sin(a) * 138} x2={160 + Math.cos(a) * 146} y2={160 + Math.sin(a) * 146} stroke="var(--ink-3)" strokeWidth="1.2" />; })}
    </svg>
  );
}

function Lines({ lines, onGo }: { lines: Line[]; onGo: (l: Line) => void }) {
  return <div className="col stagger" style={{ gap: 2, margin: "0 -10px" }}>{lines.map((l, i) => (
    <button key={i} className="list-row" style={{ textAlign: "left", alignItems: "flex-start", padding: "8px 10px" }} onClick={() => onGo(l)}>
      <Icon name={l.icon} size={16} style={{ marginTop: 3, flex: "none", color: l.tone === "warn" ? "var(--warn)" : l.tone === "good" ? "var(--good)" : "var(--hue-home)" }} /><span className="lead">{l.text}</span>
    </button>
  ))}</div>;
}

export function Orion() {
  const mode = useUI((s) => s.orion) || "brief";
  const go = useUI((s) => s.go);
  const [voice, setVoice] = useSetting("orion.voice", true);
  const [stage, setStage] = useState(mode === "wrap" ? 1 : 0); // 0 booting · 1 speaking
  const [talking, setTalking] = useState(false);
  const [shown, setShown] = useState(0);
  const b = useQ(async () => { if (mode !== "brief") return null; const now = new Date(); return compose(await gather(now, await getWeather()), now); }, [mode]).data;
  const w = useQ(async () => (mode === "wrap" ? composeWrap(await gatherDay(), new Date()) : null), [mode]).data;
  const close = () => { hush(); useUI.setState({ orion: false }); };
  const quit = () => { hush(); if (isTauri) void native.quit(); else close(); };
  const jump = (l: Line) => { if (l.world) { close(); go(l.world, { tab: l.tab }); } };
  const speech = mode === "wrap" ? w?.speech : b?.speech;

  useEffect(() => { if (!b) return; const t = setInterval(() => setShown((n) => { if (n >= b.status.length) { clearInterval(t); setTimeout(() => setStage(1), 380); return n; } return n + 1; }), 230); return () => clearInterval(t); }, [b]);
  useEffect(() => {
    if (stage !== 1 || !speech) return;
    void speak(speech);
    const t = setInterval(() => setTalking(isSpeaking()), 200);
    return () => clearInterval(t);
  }, [stage, speech]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); close(); }
      else if (e.key === "Enter") { e.stopPropagation(); mode === "wrap" ? quit() : close(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => { window.removeEventListener("keydown", onKey, true); hush(); };
    // eslint-disable-next-line
  }, [mode]);

  return (
    <div className="orion" data-world="home" role="dialog" aria-label={mode === "wrap" ? "ORION wrap-up" : "ORION briefing"}>
      <div className="orion-inner">
        <div className="col" style={{ alignItems: "center", gap: 18 }}>
          <Core speaking={talking} calm={mode === "wrap"} />
          <div className="col" style={{ gap: 5, minHeight: 92, alignItems: "flex-start" }}>
            {mode === "brief" && b?.status.slice(0, shown).map((s) => <span key={s} className="mono small row" style={{ color: "var(--ink-3)", animation: "rise var(--med) var(--ease) both" }}><Icon name="check" size={11} style={{ color: "var(--good)" }} />{s}</span>)}
            {mode === "wrap" && <span className="mono small row" style={{ color: "var(--ink-3)" }}><Icon name="check" size={11} style={{ color: "var(--good)" }} />everything saved on this computer</span>}
          </div>
        </div>
        <div className="col" style={{ gap: 0, minWidth: 0, maxWidth: 640 }}>
          <span className="label" style={{ color: "var(--hue-home)", letterSpacing: ".34em" }}>O · R · I · O · N {mode === "wrap" ? "— STANDING DOWN" : stage === 0 ? "— WAKING" : "— AWAKE"}</span>
          {mode === "brief" && stage === 1 && b && <>
            <h1 className="display" style={{ fontSize: "clamp(44px, 5vw, 76px)", margin: "14px 0 6px", animation: "rise var(--slow) var(--ease) both" }}>{b.greeting}</h1>
            <span className="mono small faint" style={{ animation: "rise var(--slow) var(--ease) both", marginBottom: 22 }}>{b.dateLine}</span>
            <Lines lines={b.lines} onGo={jump} />
            {b.mission && (
              <div className="plate lit" style={{ padding: "16px 18px", marginTop: 20, animation: "rise var(--slow) var(--ease) .35s both" }}>
                <span className="label">If you do one thing today</span>
                <div className="display" style={{ fontSize: 30, margin: "6px 0 2px" }}>{b.mission.title}</div>
                <span className="small dim">{b.mission.why}</span>
                <div className="row gap1" style={{ marginTop: 12 }}>
                  {[25, 50].map((m) => <button key={m} className={"btn sm" + (m === 25 ? " primary" : "")} onClick={() => { const t = b.mission!.title; close(); startFocus(t, m); }}><Icon name="clock" size={13} />Focus {m} min</button>)}
                  <button className="btn sm ghost" onClick={() => { close(); go(b.mission!.world, { tab: b.mission!.tab }); }}>Show me</button>
                </div>
              </div>
            )}
            <p className="dim" style={{ marginTop: 18, fontStyle: "italic", fontFamily: "var(--font-display)", fontSize: 19, animation: "rise var(--slow) var(--ease) .5s both" }}>{b.signoff}</p>
          </>}
          {mode === "wrap" && w && <>
            <h1 className="display" style={{ fontSize: "clamp(44px, 5vw, 76px)", margin: "14px 0 6px", animation: "rise var(--slow) var(--ease) both" }}>{w.greeting}</h1>
            <span className="mono small faint" style={{ marginBottom: 20 }}>{w.dateLine}</span>
            <span className="label" style={{ marginBottom: 6 }}>Today</span>
            <Lines lines={w.done} onGo={jump} />
            <span className="label" style={{ margin: "18px 0 6px" }}>Tomorrow</span>
            <Lines lines={w.ahead} onGo={jump} />
            <p className="dim" style={{ marginTop: 18, fontStyle: "italic", fontFamily: "var(--font-display)", fontSize: 19, animation: "rise var(--slow) var(--ease) .5s both" }}>{w.signoff}</p>
          </>}
        </div>
      </div>
      <div className="row gap3" style={{ position: "absolute", left: "50%", transform: "translateX(-50%)", bottom: 24 }}>
        {canSpeak() && <button className="btn ghost sm" onClick={() => { if (voice) hush(); setVoice(!voice); }}><Icon name={voice ? "bell" : "x"} size={13} />{voice ? "Voice on" : "Voice off"}</button>}
        {mode === "wrap" ? <>
          <button className="btn ghost sm" onClick={close}>Not yet <span className="kbd">Esc</span></button>
          <button className="btn sm primary" onClick={quit}>{isTauri ? "Close Personal Universe" : "Done"} <span className="kbd">Enter</span></button>
        </> : <button className="btn sm" onClick={close}>Enter the universe <span className="kbd">Enter</span></button>}
      </div>
    </div>
  );
}
