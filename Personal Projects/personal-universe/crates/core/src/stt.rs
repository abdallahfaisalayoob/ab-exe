//! Speech recognition for "talk to ORION": Whisper (whisper.cpp), compiled into the app and run
//! entirely on this computer. The only download is the model file, fetched once when the user
//! asks for it in Settings and verified against a pinned SHA-256. Audio never leaves the machine
//! and is never written to disk.

use crate::voice::{fetch, VoiceJob};
use crate::Core;
use anyhow::{anyhow, bail, Result};
use base64::Engine;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use whisper_rs::{FullParams, SamplingStrategy, WhisperContext, WhisperContextParameters};

const MODEL: &str = "ggml-base.en-q5_1.bin";
const MODEL_URL: &str = "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en-q5_1.bin";
const MODEL_SIZE: u64 = 59_721_011;
const MODEL_SHA: &str = "4baf70dd0d7c4247ba2b81fafd9c01005ac77c2f9ef064e00dcf195d0e2fdd2f";

fn model(core: &Core) -> PathBuf {
    core.data_dir.join("listen").join(MODEL)
}

pub fn status(core: &Arc<Core>) -> Value {
    json!({ "installed": model(core).is_file(), "size": MODEL_SIZE, "job": core.listen_job.lock().unwrap().clone(), "source": "huggingface.co/ggerganov/whisper.cpp" })
}

pub fn install(core: &Arc<Core>) -> Result<Value> {
    {
        let mut job = core.listen_job.lock().unwrap();
        if job.state == "downloading" {
            bail!("The download is already running.");
        }
        *job = VoiceJob { state: "downloading".into(), label: "Speech recognition model".into(), done: 0, total: MODEL_SIZE, error: None };
    }
    let core2 = core.clone();
    std::thread::Builder::new().name("pu-listen".into()).spawn(move || {
        let dest = model(&core2);
        let result = std::fs::create_dir_all(dest.parent().unwrap()).map_err(anyhow::Error::from).and_then(|_| fetch(&core2, &core2.listen_job, MODEL_URL, &dest, MODEL_SHA));
        let mut job = core2.listen_job.lock().unwrap();
        match result {
            Ok(()) => {
                job.state = "ready".into();
                job.done = job.total;
                drop(job);
                let conn = core2.conn.lock().unwrap();
                let _ = conn.execute(
                    "INSERT INTO outbound_log(ts, target, summary, files) VALUES(?, 'huggingface.co', 'Downloaded the speech-recognition model for talking to ORION. A download only — nothing of yours was sent. Your voice is processed on this computer and never stored.', '[]')",
                    [crate::db::now_ms()],
                );
            }
            Err(e) => {
                job.state = "error".into();
                job.error = Some(format!("{e:#}"));
            }
        }
    })?;
    Ok(status(core))
}

pub fn remove(core: &Arc<Core>) -> Result<Value> {
    *core.whisper.lock().unwrap() = None;
    let _ = std::fs::remove_dir_all(core.data_dir.join("listen"));
    *core.listen_job.lock().unwrap() = VoiceJob::default();
    Ok(status(core))
}

/// `pcm` is base64 of 16 kHz mono signed 16-bit little-endian samples. `prompt` biases recognition
/// towards the user's own vocabulary (course and project names).
pub fn transcribe(core: &Arc<Core>, pcm_b64: &str, prompt: &str) -> Result<Value> {
    if !model(core).is_file() {
        bail!("Speech recognition is not installed yet.");
    }
    let bytes = base64::engine::general_purpose::STANDARD.decode(pcm_b64).map_err(|_| anyhow!("invalid audio"))?;
    let mut samples: Vec<f32> = bytes.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]]) as f32 / 32768.0).collect();
    if samples.len() < 16000 / 4 {
        return Ok(json!({ "text": "" }));
    }
    samples.truncate(16000 * 30);
    // Whisper is unreliable on very short clips; pad to a little over a second of audio.
    if samples.len() < 16000 * 5 / 4 {
        samples.resize(16000 * 5 / 4, 0.0);
    }
    let mut guard = core.whisper.lock().unwrap();
    if guard.is_none() {
        let path = model(core);
        *guard = Some(WhisperContext::new_with_params(&path.to_string_lossy(), WhisperContextParameters::default()).map_err(|e| anyhow!("could not load the speech model: {e}"))?);
    }
    let ctx = guard.as_ref().unwrap();
    let mut state = ctx.create_state().map_err(|e| anyhow!("{e}"))?;
    let mut p = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    p.set_print_progress(false);
    p.set_print_realtime(false);
    p.set_print_special(false);
    p.set_print_timestamps(false);
    p.set_language(Some("en"));
    p.set_suppress_blank(true);
    p.set_n_threads(std::thread::available_parallelism().map(|n| n.get().min(6) as i32).unwrap_or(4));
    if !prompt.trim().is_empty() {
        p.set_initial_prompt(prompt);
    }
    state.full(p, &samples).map_err(|e| anyhow!("recognition failed: {e}"))?;
    let mut text = String::new();
    for i in 0..state.full_n_segments().map_err(|e| anyhow!("{e}"))? {
        text.push_str(&state.full_get_segment_text(i).unwrap_or_default());
    }
    // Whisper marks silence and noise in brackets, e.g. [BLANK_AUDIO] or (wind blowing).
    let clean: String = {
        let mut out = String::new();
        let mut depth = 0;
        for c in text.chars() {
            match c {
                '[' | '(' => depth += 1,
                ']' | ')' => depth = (depth - 1).max(0),
                _ if depth == 0 => out.push(c),
                _ => {}
            }
        }
        out.split_whitespace().collect::<Vec<_>>().join(" ")
    };
    Ok(json!({ "text": clean }))
}
