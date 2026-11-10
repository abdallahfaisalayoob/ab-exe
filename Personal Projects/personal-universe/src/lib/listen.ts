// Talking to ORION. Audio is captured in the window, handed straight to the local Whisper
// engine in the core, and discarded — it is never written to disk and never leaves the computer.
import { call, q } from "./backend";
import { toast, useUI } from "./store";

let ctx: AudioContext | null = null;
let stream: MediaStream | null = null;
let node: ScriptProcessorNode | null = null;
let chunks: Float32Array[] = [];
let startedAt = 0;
let installed: boolean | null = null;

export async function listenReady(force = false) {
  if (installed == null || force) installed = (await call<any>("stt.status").catch(() => ({ installed: false }))).installed;
  return !!installed;
}

export async function startListening() {
  if (useUI.getState().listening !== "off") return;
  if (!(await listenReady(true))) {
    toast("Talking to ORION needs the speech-recognition pack (about 60 MB, one time).", "info", { label: "Set up", run: () => useUI.setState({ settings: true }) });
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true } });
  } catch {
    toast("The microphone is not available. Allow microphone access for Personal Universe and try again.", "error");
    return;
  }
  ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  node = ctx.createScriptProcessor(4096, 1, 1);
  chunks = [];
  node.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  const mute = ctx.createGain();
  mute.gain.value = 0; // the processor must be connected to run, but nothing should be played back
  src.connect(node); node.connect(mute); mute.connect(ctx.destination);
  startedAt = Date.now();
  useUI.setState({ listening: "recording" });
}

/** 16 kHz mono 16-bit PCM, base64 — what the recogniser expects. */
export function encode(samples: Float32Array, rate: number) {
  const ratio = rate / 16000, n = Math.floor(samples.length / ratio);
  const out = new Int16Array(n);
  for (let i = 0; i < n; i++) {
    const x = i * ratio, j = Math.floor(x), f = x - j;
    const v = samples[j] + ((samples[Math.min(j + 1, samples.length - 1)] ?? 0) - samples[j]) * f;
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  const bytes = new Uint8Array(out.buffer);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export async function stopListening() {
  if (useUI.getState().listening !== "recording" || !ctx) return;
  const rate = ctx.sampleRate, held = Date.now() - startedAt;
  node?.disconnect(); stream?.getTracks().forEach((t) => t.stop()); void ctx.close();
  ctx = null; stream = null; node = null;
  const total = chunks.reduce((n, c) => n + c.length, 0), all = new Float32Array(total);
  let off = 0; for (const c of chunks) { all.set(c, off); off += c.length; }
  chunks = [];
  if (held < 350) { useUI.setState({ listening: "off" }); toast("Hold the key while you speak, then let go."); return; }
  useUI.setState({ listening: "thinking" });
  try {
    // The user's own vocabulary helps the recogniser spell course and project names.
    const names = await q<{ name: string }>("SELECT name FROM courses WHERE archived = 0 UNION SELECT name FROM projects WHERE status = 'active' LIMIT 30").catch(() => []);
    const prompt = names.length ? `Commands for a student planner. Names: ${names.map((n) => n.name).join(", ")}.` : "Commands for a student planner.";
    const { text } = await call<{ text: string }>("stt.transcribe", { pcm: encode(all, rate), prompt });
    useUI.setState({ listening: "off" });
    heard(text);
  } catch (e: any) {
    useUI.setState({ listening: "off" });
    toast(String(e?.message ?? e), "error");
  }
}

/** Spoken text → the command bar's grammar. */
export function normalise(text: string) {
  let t = text.trim().replace(/[.!?]+$/g, "").replace(/\bp\.?\s?m\.?(?=\s|$)/gi, "pm").replace(/\ba\.?\s?m\.?(?=\s|$)/gi, "am").replace(/(\d)\s+(am|pm)\b/gi, "$1$2").replace(/\s+/g, " ");
  t = t.replace(/^(?:hey |ok |okay )?orion[,.]?\s*/i, "").replace(/^(?:please |can you |could you )/i, "");
  const low = t.toLowerCase();
  let m: RegExpMatchArray | null;
  if (!low || /^(brief me|briefing|good morning|what'?s (?:next|on today|up)|what do i have(?: today)?|status report)$/.test(low)) return "orion brief";
  if (/^(wrap up|wrap it up|good ?night|i'?m done(?: for (?:the day|today))?|call it a day|end of day)$/.test(low)) return "orion wrap up";
  if ((m = low.match(/^(?:start |begin )?(?:a |an )?(?:(\d+)[- ]minute )?focus(?: block| timer| session)?(?: (?:for|of) (\d+)(?: minutes?)?)?$/))) return `orion focus ${m[1] ?? m[2] ?? 25}`;
  if (/joke|make me laugh/.test(low)) return "orion joke";
  if (/^who are you|what are you|your name/.test(low)) return "orion who are you";
  return t;
}

export function heard(raw: string) {
  const text = normalise(raw);
  if (!raw.trim()) { toast("I didn't catch that. Hold the key, speak, then let go."); return; }
  useUI.setState({ seed: { text, auto: true }, palette: true });
}
