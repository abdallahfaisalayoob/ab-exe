// AI handoff. The app prepares; the user sends. Nothing is transmitted by Personal Universe
// itself, and the interface never claims a file was uploaded.
import { useEffect, useMemo, useState } from "react";
import { call, isTauri, native, q, run } from "../lib/backend";
import { bytes } from "../lib/format";
import { useRows } from "../lib/hooks";
import { SUBJECTS } from "../lib/prompts";
import { attempt, toast, useUI } from "../lib/store";
import { Icon, KIND_ICON } from "../ui/Icons";
import { Check, Field, Modal, Seg } from "../ui/kit";

const TARGETS = { claude: { name: "Claude", url: "https://claude.ai/new", param: "q" }, chatgpt: { name: "ChatGPT", url: "https://chatgpt.com/", param: "q" } } as const;
const STATUS: Record<string, [string, string]> = { copied: ["Copy ready to attach", "good"], missing: ["Original not found — not included", "bad"], "too-large": ["Over 200 MB — attach it from its original location", "warn"], unreadable: ["Could not be read — not included", "bad"] };

export function Handoff() {
  const req = useUI((s) => s.handoff)!;
  const close = () => useUI.getState().set({ handoff: null });
  const prompts = useRows<any>("SELECT * FROM prompts ORDER BY builtin DESC, uses DESC, id");
  const [files, setFiles] = useState<any[]>([]);
  const [subject, setSubject] = useState("General");
  const [promptId, setPromptId] = useState<number | null>(req.promptId ?? null);
  const [text, setText] = useState("");
  const [target, setTarget] = useState<keyof typeof TARGETS>("claude");
  const [includeText, setIncludeText] = useState(false);
  const [prefill, setPrefill] = useState(true);
  const [result, setResult] = useState<any>(null);
  const [opened, setOpened] = useState(false);

  useEffect(() => {
    if (req.fileIds.length) q<any>(`SELECT id, name, kind, size, path, missing, text_len FROM files WHERE id IN (${req.fileIds.map(() => "?").join(",")})`, req.fileIds).then(setFiles);
  }, [req.fileIds]);
  useEffect(() => {
    if (!prompts.length || text) return;
    const p = prompts.find((x) => x.id === promptId) ?? prompts.find((x) => x.subject === subject) ?? prompts[0];
    if (p) { setPromptId(p.id); setSubject(p.subject); setText(p.body); }
    // eslint-disable-next-line
  }, [prompts.length]);

  const subjects = useMemo(() => [...new Set([...SUBJECTS, ...prompts.map((p) => p.subject)])], [prompts]);
  const t = TARGETS[target];
  const urlOk = prefill && text.length <= 3500;

  const prepare = () => attempt(async () => {
    if (!text.trim()) throw new Error("Write or choose a prompt first.");
    const title = prompts.find((p) => p.id === promptId)?.title ?? "handoff";
    const r = await call<any>("handoff.prepare", { prompt: text, title, target, fileIds: files.map((f) => f.id), includeText });
    await native.copy(text).catch(() => {});
    if (promptId) await run("UPDATE prompts SET uses = uses + 1 WHERE id = ?", [promptId]);
    setResult(r);
  });
  const open = () => attempt(async () => {
    await native.openUrl(urlOk ? `${t.url}?${t.param}=${encodeURIComponent(text)}` : t.url);
    await run("INSERT INTO outbound_log(ts, target, summary, files, dir) VALUES(?,?,?,?,?)", [Date.now(), target, urlOk ? `Opened ${t.name} in the browser with the prompt text pre-filled. Files are attached manually by you.` : `Opened ${t.name} in the browser. Prompt and files are pasted/attached manually by you.`, JSON.stringify(files.map((f) => f.name)), result?.dir ?? null]);
    setOpened(true);
  });

  if (result) {
    const copied = result.files.filter((f: any) => f.status === "copied").length;
    return (
      <Modal title="Ready to hand off" sub={`Nothing has been sent. ${t.name} only receives what you paste or attach yourself.`} onClose={close} wide
        foot={<><button className="btn ghost" style={{ marginRight: "auto" }} onClick={() => setResult(null)}>Back</button><button className="btn" onClick={() => attempt(() => native.copy(text), "Prompt copied.")}><Icon name="copy" size={14} />Copy prompt again</button>{isTauri && <button className="btn" onClick={() => attempt(() => native.openPath(result.dir))}><Icon name="folder" size={14} />Open prepared folder</button>}<button className="btn primary" onClick={open}><Icon name="external" size={14} />Open {t.name}</button></>}>
        <div className="col gap3">
          {[
            ["Prompt copied to your clipboard", `Also saved as PROMPT.md in the prepared folder.${urlOk ? ` Opening ${t.name} will pre-fill it in the message box.` : ""}`, true],
            [files.length ? `${copied} of ${files.length} file${files.length === 1 ? "" : "s"} copied into one folder` : "No files in this handoff", files.length ? "Copies only — your originals were not touched. Drag them from the folder into the chat." : "Prompt only.", copied === files.length],
            [opened ? `${t.name} was opened in your browser` : `Open ${t.name} when you are ready`, opened ? "Paste the prompt (Ctrl V), attach the files from the folder, and send. This step is yours — the app cannot see whether you did." : "Opening the site is the first moment anything leaves this computer, and it is recorded in your privacy ledger.", opened],
          ].map(([a, b, ok], i) => (
            <div key={i} className="row gap3" style={{ alignItems: "flex-start" }}>
              <span className="check on" style={ok ? {} : { background: "transparent", borderColor: "var(--ink-4)", color: "var(--ink-3)" }}>{ok ? <Icon name="check" size={12} stroke={2.4} /> : <span className="small mono">{i + 1}</span>}</span>
              <div className="col" style={{ gap: 1 }}><span>{a}</span><span className="small faint">{b}</span></div>
            </div>
          ))}
        </div>
        {result.files.length > 0 && <div className="plate" style={{ padding: 6 }}>{result.files.map((f: any) => (
          <div key={f.id} className="list-row small"><Icon name="file" size={15} /><span className="grow truncate">{f.name}</span><span className={STATUS[f.status][1]}>{STATUS[f.status][0]}</span></div>
        ))}{result.textPath && <div className="list-row small"><Icon name="note" size={15} /><span className="grow">EXTRACTED_TEXT.md</span><span className="good">Text of the documents, in one file</span></div>}</div>}
        <p className="small faint selectable mono" style={{ wordBreak: "break-all" }}>{result.dir}</p>
      </Modal>
    );
  }

  return (
    <Modal title="Hand off to an assistant" sub="Choose a learning workflow. No API key, no account link — you stay in control of what is sent." onClose={close} wide
      foot={<><span className="small faint row" style={{ marginRight: "auto" }}><Icon name="shield" size={14} />Preparing does not transmit anything</span><button className="btn ghost" onClick={close}>Cancel</button><button className="btn primary" onClick={prepare}>Prepare handoff</button></>}>
      <div style={{ display: "grid", gridTemplateColumns: "250px 1fr", gap: 20, minHeight: 380 }}>
        <div className="col gap3" style={{ minHeight: 0 }}>
          <select className="select" value={subject} onChange={(e) => setSubject(e.target.value)}>{subjects.map((s) => <option key={s}>{s}</option>)}</select>
          <div className="scroll" style={{ maxHeight: 360, margin: "0 -6px" }}>
            {prompts.filter((p) => p.subject === subject).map((p) => (
              <button key={p.id} className={"list-row small" + (p.id === promptId ? " on" : "")} style={{ width: "100%", textAlign: "left" }} onClick={() => { setPromptId(p.id); setText(p.body); }}>
                <Icon name="spark" size={14} style={{ color: p.id === promptId ? "var(--hue)" : "var(--ink-4)", flex: "none" }} /><span className="clamp2">{p.title}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="col gap3">
          <Field label="Prompt — edit freely for this handoff"><textarea className="textarea" rows={9} value={text} onChange={(e) => { setText(e.target.value); }} /></Field>
          {files.length > 0 ? (
            <div className="col gap1"><span className="label">Material ({files.length})</span>
              <div className="row wrap gap1">{files.map((f) => <span key={f.id} className={"chip tint kind-" + f.kind} title={f.path}><Icon name={KIND_ICON[f.kind]} size={12} />{f.name} · {bytes(f.size)}{f.missing ? " · missing" : ""}<button onClick={() => setFiles(files.filter((x) => x.id !== f.id))} aria-label="Remove"><Icon name="x" size={10} /></button></span>)}</div>
            </div>
          ) : <p className="small faint">No files selected — this will be a prompt-only handoff. Select files in Knowledge or a course to include them.</p>}
          <div className="row between wrap gap3">
            <Field label="Send with"><Seg value={target} onChange={setTarget} options={[{ value: "claude", label: "Claude" }, { value: "chatgpt", label: "ChatGPT" }]} /></Field>
            <div className="col gap1">
              {files.some((f) => f.text_len > 0) && <label className="row small dim"><Check on={includeText} onChange={setIncludeText} label="Include extracted text" />Also write the documents' extracted text to one file</label>}
              <label className="row small dim"><Check on={prefill} onChange={setPrefill} label="Pre-fill prompt" />Pre-fill the prompt when the site opens{prefill && text.length > 3500 ? " (too long — will be pasted instead)" : ""}</label>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}
