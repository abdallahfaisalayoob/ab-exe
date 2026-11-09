// Tools — an engineer's bench that works offline, plus the capture inbox.
import { ReactNode, useMemo, useState } from "react";
import { native, run } from "../lib/backend";
import { capture, captureClipboard } from "../lib/actions";
import { ago } from "../lib/dates";
import { BANDS, TOLERANCE, UNITS, convertUnit, fmtEng, ohm, parseEng, resistor, toBases, truthTable } from "../lib/eng";
import { useIntent, useRows } from "../lib/hooks";
import { attempt, useUI } from "../lib/store";
import { Icon } from "../ui/Icons";
import { Confirm, Empty, Seg, Tabs } from "../ui/kit";

function Tool({ title, hint, children, span = 1 }: { title: string; hint?: string; children: ReactNode; span?: number }) {
  return <section className="plate lit col" style={{ padding: 20, gap: 14, gridColumn: `span ${span}` }}><div className="col" style={{ gap: 2 }}><h3 className="display" style={{ fontSize: 24 }}>{title}</h3>{hint && <span className="small faint">{hint}</span>}</div>{children}</section>;
}
function In({ label, value, onChange, unit, w }: { label: string; value: string; onChange: (v: string) => void; unit?: string; w?: number }) {
  return <label className="field" style={{ width: w }}><span>{label}</span><div style={{ position: "relative" }}><input className="input mono" value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />{unit && <span className="faint mono small" style={{ position: "absolute", right: 10, top: 8 }}>{unit}</span>}</div></label>;
}
function Out({ label, value }: { label: string; value: string }) {
  return <div className="col" style={{ gap: 1 }}><span className="label" style={{ fontSize: 9.5 }}>{label}</span><button className="mono selectable" style={{ fontSize: 17, textAlign: "left" }} title="Click to copy" onClick={() => attempt(() => native.copy(value), "Copied.")}>{value}</button></div>;
}

function OhmTool() {
  const [v, setV] = useState({ V: "12", I: "", R: "4.7k", P: "" });
  const known = Object.fromEntries(Object.entries(v).filter(([, s]) => s.trim()).map(([k, s]) => [k, parseEng(s)]));
  const n = Object.keys(known).length, r = n === 2 && Object.values(known).every(Number.isFinite) ? ohm(known) : null;
  return (
    <Tool title="Ohm's law & power" hint="Fill in any two. Engineering suffixes work: 4.7k, 10m, 2M2.">
      <div className="grid2">{([["V", "Voltage", "V"], ["I", "Current", "A"], ["R", "Resistance", "Ω"], ["P", "Power", "W"]] as const).map(([k, label, unit]) => <In key={k} label={label} unit={unit} value={v[k]} onChange={(s) => setV({ ...v, [k]: s })} />)}</div>
      {r ? <div className="row gap5 wrap"><Out label="V" value={fmtEng(r.V, "V")} /><Out label="I" value={fmtEng(r.I, "A")} /><Out label="R" value={fmtEng(r.R, "Ω")} /><Out label="P" value={fmtEng(r.P, "W")} /></div> : <span className="small faint">{n < 2 ? "Enter two values." : n > 2 ? "Clear two fields — exactly two values define the rest." : "One of the values is not a number."}</span>}
      <button className="btn sm ghost" style={{ alignSelf: "flex-start" }} onClick={() => setV({ V: "", I: "", R: "", P: "" })}>Clear</button>
    </Tool>
  );
}

function ResistorTool() {
  const [n, setN] = useState<"4" | "5">("4");
  const [b, setB] = useState([4, 7, 0, 2, 10]); // digits…, multiplier, tolerance
  const digits = n === "4" ? b.slice(0, 2) : b.slice(0, 3);
  const r = resistor(digits, b[3], b[4]);
  const bands = [...digits, b[3], b[4]];
  const Pick = ({ i, allowed, label }: { i: number; allowed: number[]; label: string }) => (
    <div className="col gap1"><span className="label" style={{ fontSize: 9.5 }}>{label}</span><div className="row wrap" style={{ gap: 4, maxWidth: 150 }}>{allowed.map((c) => <button key={c} title={BANDS[c][0]} aria-label={`${label} ${BANDS[c][0]}`} onClick={() => setB(b.map((x, j) => (j === i ? c : x)))} style={{ width: 20, height: 20, borderRadius: 5, background: BANDS[c][1], outline: b[i] === c ? "2px solid var(--ink)" : "1px solid var(--line-2)", outlineOffset: b[i] === c ? 2 : 0 }} />)}</div></div>
  );
  const D = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  return (
    <Tool title="Resistor colour code" hint="Choose the bands as they appear on the part.">
      <div className="row between gap4"><Seg value={n} onChange={setN} options={[{ value: "4", label: "4 bands" }, { value: "5", label: "5 bands" }]} />
        <svg width="210" height="46" viewBox="0 0 210 46" aria-hidden><line x1="0" y1="23" x2="210" y2="23" stroke="var(--ink-3)" strokeWidth="2.5" /><rect x="38" y="5" width="134" height="36" rx="14" fill="#D9C39A" />{bands.map((c, i) => <rect key={i} x={i === bands.length - 1 ? 148 : 54 + i * (n === "4" ? 22 : 19)} y="5" width="9" height="36" fill={BANDS[c][1]} />)}</svg></div>
      <div className="row gap4 wrap" style={{ alignItems: "flex-start" }}><Pick i={0} allowed={D.slice(1)} label="1st" /><Pick i={1} allowed={D} label="2nd" />{n === "5" && <Pick i={2} allowed={D} label="3rd" />}<Pick i={3} allowed={[...D.slice(0, 8), 10, 11]} label="Multiplier" /><Pick i={4} allowed={Object.keys(TOLERANCE).map(Number)} label="Tolerance" /></div>
      <div className="row gap5 wrap"><Out label="Resistance" value={`${fmtEng(r.value, "Ω")} ±${r.tol}%`} /><Out label="Range" value={`${fmtEng(r.min, "Ω")} – ${fmtEng(r.max, "Ω")}`} /></div>
    </Tool>
  );
}

function WaveTool() {
  const [f, setF] = useState("2.4G"); const [vf, setVf] = useState("1");
  const hz = parseEng(f), k = parseFloat(vf) || 1, lam = (299792458 * k) / hz;
  return (
    <Tool title="Frequency & wavelength" hint="λ = v / f, with v = c × velocity factor.">
      <div className="grid2"><In label="Frequency" unit="Hz" value={f} onChange={setF} /><In label="Velocity factor" value={vf} onChange={setVf} /></div>
      {Number.isFinite(lam) && hz > 0 ? <div className="row gap5 wrap"><Out label="Wavelength λ" value={fmtEng(lam, "m")} /><Out label="λ/2 dipole" value={fmtEng(lam / 2, "m")} /><Out label="λ/4" value={fmtEng(lam / 4, "m")} /><Out label="Period" value={fmtEng(1 / hz, "s")} /></div> : <span className="small faint">Enter a frequency such as 100M or 2.4G.</span>}
    </Tool>
  );
}

function DbTool() {
  const [a, setA] = useState("2"); const [b, setB] = useState("1"); const [dbm, setDbm] = useState("20");
  const r = parseEng(a) / parseEng(b), d = parseFloat(dbm);
  return (
    <Tool title="Decibels" hint="Ratios in dB, and dBm ↔ watts.">
      <div className="grid2"><In label="Output (P₂ or V₂)" value={a} onChange={setA} /><In label="Input (P₁ or V₁)" value={b} onChange={setB} /></div>
      {r > 0 && Number.isFinite(r) ? <div className="row gap5 wrap"><Out label="As power ratio" value={`${(10 * Math.log10(r)).toFixed(3)} dB`} /><Out label="As voltage ratio" value={`${(20 * Math.log10(r)).toFixed(3)} dB`} /><Out label="Ratio" value={parseFloat(r.toPrecision(5)).toString()} /></div> : <span className="small faint">Both values must be positive.</span>}
      <hr className="hr" />
      <div className="row gap5 wrap" style={{ alignItems: "flex-end" }}><In label="Level" unit="dBm" value={dbm} onChange={setDbm} w={150} />{Number.isFinite(d) && <><Out label="Power" value={fmtEng(Math.pow(10, d / 10) / 1000, "W")} /><Out label="Into 50 Ω" value={fmtEng(Math.sqrt((Math.pow(10, d / 10) / 1000) * 50), "V rms")} /></>}</div>
    </Tool>
  );
}

function BaseTool() {
  const [text, setText] = useState("255"); const [base, setBase] = useState("10"); const [bits, setBits] = useState("0");
  const r = toBases(text, +base, +bits);
  return (
    <Tool title="Binary · hex · decimal" hint="Negative numbers use two's complement at the chosen width.">
      <div className="row gap3 wrap" style={{ alignItems: "flex-end" }}><In label="Value" value={text} onChange={setText} w={190} /><Seg value={base} onChange={setBase} options={[{ value: "2", label: "BIN" }, { value: "8", label: "OCT" }, { value: "10", label: "DEC" }, { value: "16", label: "HEX" }]} /><Seg value={bits} onChange={setBits} options={[{ value: "0", label: "Any" }, { value: "8", label: "8-bit" }, { value: "16", label: "16" }, { value: "32", label: "32" }]} /></div>
      {r ? <div className="col gap3"><div className="row gap5 wrap"><Out label="Decimal" value={r.dec} /><Out label="Hex" value={"0x" + r.hex} /><Out label="Octal" value={r.oct} /></div><Out label="Binary" value={r.bin.replace(/(?=(?:.{4})+$)/g, " ").trim()} /></div> : <span className="small faint">Not a valid base-{base} number.</span>}
    </Tool>
  );
}

function LogicTool() {
  const [expr, setExpr] = useState("A & (B | !C)");
  const t = useMemo(() => { try { return { ok: truthTable(expr) }; } catch (e: any) { return { err: String(e.message) }; } }, [expr]);
  return (
    <Tool title="Boolean algebra & logic gates" span={2} hint="Operators: & · AND, | + OR, ! ~ NOT, ' (postfix), ^ XOR, NAND, NOR, XNOR. Capitals are single-letter variables, so AB means A·B.">
      <input className="input mono" value={expr} onChange={(e) => setExpr(e.target.value)} spellCheck={false} aria-label="Boolean expression" />
      <div className="row gap1 wrap">{["A & B", "A | B", "!A", "A ^ B", "A NAND B", "A NOR B", "A XNOR B", "AB + A'C + BC", "(A ^ B) ^ Cin"].map((x) => <button key={x} className="chip mono" onClick={() => setExpr(x)}>{x}</button>)}</div>
      {t.err ? <span className="small warn">{t.err}</span> : (
        <div className="row gap6 wrap" style={{ alignItems: "flex-start" }}>
          <table className="table mono" style={{ width: "auto", fontSize: 12.5 }}><thead><tr>{t.ok!.vars.map((v) => <th key={v}>{v}</th>)}<th className="hue">out</th></tr></thead>
            <tbody>{t.ok!.rows.map((r, i) => <tr key={i}>{r.in.map((b, j) => <td key={j} className="faint" style={{ padding: "4px 12px" }}>{b ? 1 : 0}</td>)}<td style={{ padding: "4px 12px", color: r.out ? "var(--hue)" : "var(--ink-4)", fontWeight: 600 }}>{r.out ? 1 : 0}</td></tr>)}</tbody></table>
          <div className="col gap3"><Out label="Minterms" value={t.ok!.minterms.length ? `Σm(${t.ok!.minterms.join(", ")})` : "none — always 0"} /><Out label="True in" value={`${t.ok!.minterms.length} of ${t.ok!.rows.length} rows`} />{t.ok!.minterms.length === t.ok!.rows.length && <span className="chip tint">tautology</span>}</div>
        </div>)}
    </Tool>
  );
}

function CircuitTool() {
  const [r, setR] = useState("10k"); const [c, setC] = useState("100n"); const [l, setL] = useState("10m"); const [vin, setVin] = useState("5"); const [r2, setR2] = useState("10k"); const [f, setF] = useState("1k");
  const R = parseEng(r), C = parseEng(c), L = parseEng(l), V = parseEng(vin), R2 = parseEng(r2), F = parseEng(f);
  const ok = (...x: number[]) => x.every((n) => Number.isFinite(n) && n > 0);
  return (
    <Tool title="Circuits & communication formulas" span={2} hint="RC / RL / LC, divider and reactance — the ones you reach for in every lab.">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(6, 1fr)", gap: 10 }}><In label="R (R₁)" unit="Ω" value={r} onChange={setR} /><In label="R₂" unit="Ω" value={r2} onChange={setR2} /><In label="C" unit="F" value={c} onChange={setC} /><In label="L" unit="H" value={l} onChange={setL} /><In label="Vin" unit="V" value={vin} onChange={setVin} /><In label="f" unit="Hz" value={f} onChange={setF} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "16px 24px" }}>
        {ok(R, C) && <><Out label="RC time constant τ" value={fmtEng(R * C, "s")} /><Out label="RC cutoff 1/(2πRC)" value={fmtEng(1 / (2 * Math.PI * R * C), "Hz")} /></>}
        {ok(R, L) && <><Out label="RL time constant L/R" value={fmtEng(L / R, "s")} /><Out label="RL cutoff R/(2πL)" value={fmtEng(R / (2 * Math.PI * L), "Hz")} /></>}
        {ok(L, C) && <><Out label="LC resonance" value={fmtEng(1 / (2 * Math.PI * Math.sqrt(L * C)), "Hz")} /><Out label="Characteristic Z₀ √(L/C)" value={fmtEng(Math.sqrt(L / C), "Ω")} /></>}
        {ok(R, R2, V) && <><Out label="Divider Vout (across R₂)" value={fmtEng((V * R2) / (R + R2), "V")} /><Out label="R₁ ∥ R₂" value={fmtEng((R * R2) / (R + R2), "Ω")} /></>}
        {ok(C, F) && <Out label="Capacitive reactance" value={fmtEng(1 / (2 * Math.PI * F * C), "Ω")} />}
        {ok(L, F) && <Out label="Inductive reactance" value={fmtEng(2 * Math.PI * F * L, "Ω")} />}
        {ok(R, L, C) && <Out label="Series RLC Q" value={parseFloat(((1 / R) * Math.sqrt(L / C)).toPrecision(4)).toString()} />}
        {ok(F) && <Out label="Nyquist sampling rate" value={fmtEng(2 * F, "Hz")} />}
      </div>
    </Tool>
  );
}

function UnitTool() {
  const [g, setG] = useState("Length"); const [v, setV] = useState("1"); const [from, setFrom] = useState("inch"); const [to, setTo] = useState("mm");
  const units = Object.keys(UNITS[g]);
  const pick = (group: string) => { setG(group); const u = Object.keys(UNITS[group]); setFrom(u[0]); setTo(u[1]); };
  const n = parseFloat(v), r = units.includes(from) && units.includes(to) ? convertUnit(g, n, from, to) : NaN;
  return (
    <Tool title="Unit conversions">
      <div className="row wrap gap1">{Object.keys(UNITS).map((k) => <button key={k} className={"chip" + (g === k ? " on" : "")} onClick={() => pick(k)}>{k}</button>)}</div>
      <div className="row gap3" style={{ alignItems: "flex-end" }}><In label="Value" value={v} onChange={setV} w={130} /><select className="select" style={{ width: 96 }} value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From unit">{units.map((u) => <option key={u}>{u}</option>)}</select><button className="icon-btn" onClick={() => { setFrom(to); setTo(from); }} aria-label="Swap units"><Icon name="repeat" size={15} /></button><select className="select" style={{ width: 96 }} value={to} onChange={(e) => setTo(e.target.value)} aria-label="To unit">{units.map((u) => <option key={u}>{u}</option>)}</select></div>
      {Number.isFinite(r) ? <Out label="Result" value={`${parseFloat(r.toPrecision(8))} ${to}`} /> : <span className="small faint">Enter a number.</span>}
    </Tool>
  );
}

function CaptureInbox() {
  const set = useUI((s) => s.set);
  const [show, setShow] = useState<"open" | "done">("open");
  const notes = useRows<any>("SELECT * FROM notes WHERE owner_type = 'capture' AND state = ? ORDER BY created_at DESC LIMIT 300", [show]);
  const projects = useRows<any>("SELECT id, name FROM projects WHERE status = 'active' ORDER BY name");
  const [text, setText] = useState("");
  const finish = (id: number) => run("UPDATE notes SET state = 'done', updated_at = ? WHERE id = ?", [Date.now(), id]);
  return (
    <div className="col gap4" style={{ maxWidth: 860 }}>
      <div className="plate pad lit col gap3">
        <textarea className="textarea" rows={3} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && text.trim()) { void capture(text); setText(""); } }} placeholder="An idea, a link, a line from a lecture…  Ctrl + Enter to capture" />
        <div className="row between"><span className="small faint">Capture from anywhere with Ctrl ⇧ V (clipboard) or by typing “note …” in the command bar.</span><div className="row"><button className="btn" onClick={() => captureClipboard()}><Icon name="copy" size={14} />Capture clipboard</button><button className="btn primary" disabled={!text.trim()} onClick={() => { void capture(text); setText(""); }}>Capture</button></div></div>
      </div>
      <Seg value={show} onChange={setShow} options={[{ value: "open", label: "To sort" }, { value: "done", label: "Sorted" }]} />
      {notes.length === 0 ? <Empty icon="note" title={show === "open" ? "Nothing waiting" : "Nothing sorted yet"}>Captured thoughts wait here until you turn them into a deadline, a task, or simply mark them done.</Empty> : notes.map((n) => (
        <div key={n.id} className="plate col" style={{ padding: "14px 16px", gap: 10 }}>
          <p className="selectable" style={{ whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{n.body}</p>
          <div className="row gap1 wrap"><span className="small faint">{n.title} · {ago(n.created_at)}</span><span className="grow" />
            {show === "open" && <>
              <button className="btn sm ghost" onClick={() => { set({ quick: { type: "deadline", init: { title: n.body.split("\n")[0].slice(0, 120), notes: n.body.length > 120 ? n.body : "" } } }); void finish(n.id); }}><Icon name="flag" size={12} />Make a deadline</button>
              {projects.slice(0, 3).map((p) => <button key={p.id} className="btn sm ghost" onClick={() => attempt(async () => { await run("INSERT INTO tasks(project_id, title, sort, created_at) VALUES(?,?,?,?)", [p.id, n.body.split("\n")[0].slice(0, 160), Date.now(), Date.now()]); await finish(n.id); }, `Added as a task in ${p.name}.`)}><Icon name="projects" size={12} />Task in {p.name}</button>)}
              <button className="btn sm ghost" onClick={() => attempt(() => native.copy(n.body), "Copied.")}><Icon name="copy" size={12} />Copy</button>
              <button className="btn sm" onClick={() => finish(n.id)}><Icon name="check" size={12} />Done</button>
            </>}
            <Confirm onConfirm={() => run("DELETE FROM notes WHERE id = ?", [n.id])} /></div>
        </div>
      ))}
    </div>
  );
}

export default function Tools() {
  const [tab, setTab] = useState<"bench" | "capture">("bench");
  useIntent("tools", (i) => { if (i.tab) setTab(i.tab as any); });
  const open = useRows<any>("SELECT COUNT(*) n FROM notes WHERE owner_type = 'capture' AND state = 'open'")[0]?.n;
  return (
    <>
      <div className="world-head"><div><h1 className="display">Tools</h1><p className="sub">Calculators an electrical engineer actually uses, and a place to catch stray thoughts. Everything works offline.</p></div></div>
      <Tabs value={tab} onChange={setTab} tabs={[{ id: "bench", label: "Engineering bench" }, { id: "capture", label: "Capture inbox", count: open }]} />
      <div className="world-body">
        {tab === "capture" ? <CaptureInbox /> : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 18 }}><OhmTool /><ResistorTool /><LogicTool /><BaseTool /><DbTool /><CircuitTool /><WaveTool /><UnitTool /></div>
        )}
      </div>
    </>
  );
}
