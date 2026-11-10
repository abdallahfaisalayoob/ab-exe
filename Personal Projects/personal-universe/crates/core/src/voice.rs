//! Natural voice for ORION: the Piper neural speech engine, running entirely on this computer.
//!
//! Nothing here runs unless the user asks for the voice pack in Settings. Installing it is a
//! one-time download (engine from github.com/rhasspy/piper, voice model from
//! huggingface.co/rhasspy/piper-voices); every file is checked against a pinned SHA-256 before
//! it is used. After that, speech is synthesised offline and no text ever leaves the machine.

use crate::Core;
use anyhow::{anyhow, bail, Context, Result};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Arc;

pub struct Voice { pub id: &'static str, pub label: &'static str, pub path: &'static str, pub size: u64, pub sha: &'static str, pub sha_json: &'static str }
pub const VOICES: &[Voice] = &[
    Voice { id: "en_GB-alan-medium", label: "Alan — British, male", path: "en/en_GB/alan/medium", size: 63_201_294, sha: "0a309668932205e762801f1efc2736cd4b0120329622adf62be09e56339d3330", sha_json: "c0f0d124e5895c00e7c03b35dcc8287f319a6998a365b182deb5c8e752ee8c1e" },
    Voice { id: "en_GB-northern_english_male-medium", label: "Northern — British, male", path: "en/en_GB/northern_english_male/medium", size: 63_201_294, sha: "57a219ae8e638873db7d18893304be5069c42868f392bb95c3ff17f0690d0689", sha_json: "69557ed3d974463453e9b0c09dd99a7ed0e52b8b87b64b357dbeeb2540a97d47" },
    Voice { id: "en_US-ryan-high", label: "Ryan — American, male (high quality)", path: "en/en_US/ryan/high", size: 120_786_792, sha: "b3990d7606e183ec8dbfba70a4607074f162de1a0c412e0180d1ff60bb154eca", sha_json: "c6d3b98f08315cb4bebf0d49d50fc4ff491b503c64b940cd3d5ca28543b48011" },
    Voice { id: "en_GB-cori-high", label: "Cori — British, female (high quality)", path: "en/en_GB/cori/high", size: 114_219_352, sha: "470b4dd634c98f8a4850d7626ffc3dfc90774628eeef6605a6dd8f88f30a5903", sha_json: "9e7fb5b5671612c22f3c81cbe46c1ae87b031a4632bcb509e499dad6f1e2adec" },
];

#[cfg(windows)]
const ENGINE: (&str, u64, &str) = ("piper_windows_amd64.zip", 22_477_236, "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea");
#[cfg(not(windows))]
const ENGINE: (&str, u64, &str) = ("piper_linux_x86_64.tar.gz", 26_460_462, "a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992");
const ENGINE_URL: &str = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/";
const VOICE_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/";

#[derive(Clone, Default, Serialize)]
pub struct VoiceJob { pub state: String, pub label: String, pub done: u64, pub total: u64, pub error: Option<String> }

fn dir(core: &Core) -> PathBuf { core.data_dir.join("voice") }
fn exe(core: &Core) -> PathBuf { dir(core).join("engine").join("piper").join(if cfg!(windows) { "piper.exe" } else { "piper" }) }
fn model(core: &Core, id: &str) -> PathBuf { dir(core).join("models").join(format!("{id}.onnx")) }
fn find(id: &str) -> Result<&'static Voice> { VOICES.iter().find(|v| v.id == id).ok_or_else(|| anyhow!("unknown voice")) }
fn installed(core: &Core, id: &str) -> bool { exe(core).is_file() && model(core, id).is_file() && model(core, id).with_extension("onnx.json").is_file() }

pub fn status(core: &Arc<Core>) -> Value {
    let job = core.voice.lock().unwrap().clone();
    json!({
        "engine": exe(core).is_file(), "job": job,
        "voices": VOICES.iter().map(|v| json!({ "id": v.id, "label": v.label, "size": v.size, "installed": installed(core, v.id) })).collect::<Vec<_>>(),
        "engineSize": ENGINE.1, "sources": ["github.com/rhasspy/piper", "huggingface.co/rhasspy/piper-voices"],
    })
}

/// Streams a URL to `dest`, reporting progress, and refuses the file unless its SHA-256 matches.
fn fetch(core: &Core, url: &str, dest: &Path, sha: &str) -> Result<()> {
    let agent = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(20)).timeout_read(std::time::Duration::from_secs(60)).build();
    let resp = agent.get(url).call().map_err(|e| anyhow!("Download failed ({e}). Check your internet connection and try again."))?;
    let tmp = dest.with_extension("part");
    let mut out = std::fs::File::create(&tmp)?;
    let mut reader = resp.into_reader();
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = reader.read(&mut buf).context("the download was interrupted")?;
        if n == 0 { break; }
        out.write_all(&buf[..n])?;
        hasher.update(&buf[..n]);
        core.voice.lock().unwrap().done += n as u64;
    }
    drop(out);
    let got = hasher.finalize().iter().map(|b| format!("{b:02x}")).collect::<String>();
    if got != sha {
        let _ = std::fs::remove_file(&tmp);
        bail!("A downloaded file did not match its expected fingerprint and was discarded. Nothing was installed.");
    }
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

fn unpack(archive: &Path, into: &Path) -> Result<()> {
    std::fs::create_dir_all(into)?;
    if archive.extension().map(|e| e == "zip").unwrap_or(false) {
        let mut z = zip::ZipArchive::new(std::fs::File::open(archive)?)?;
        for i in 0..z.len() {
            let mut f = z.by_index(i)?;
            // `enclosed_name` rejects entries that would escape the target folder.
            let Some(rel) = f.enclosed_name() else { continue };
            let out = into.join(rel);
            if f.is_dir() { std::fs::create_dir_all(&out)?; continue; }
            if let Some(p) = out.parent() { std::fs::create_dir_all(p)?; }
            std::io::copy(&mut f, &mut std::fs::File::create(&out)?)?;
        }
    } else {
        let ok = Command::new("tar").arg("xzf").arg(archive).arg("-C").arg(into).status()?.success();
        if !ok { bail!("could not unpack the speech engine"); }
    }
    Ok(())
}

fn install_blocking(core: &Arc<Core>, v: &Voice) -> Result<()> {
    let root = dir(core);
    std::fs::create_dir_all(root.join("models"))?;
    if !exe(core).is_file() {
        core.voice.lock().unwrap().label = "Speech engine".into();
        let archive = root.join(ENGINE.0);
        fetch(core, &format!("{ENGINE_URL}{}", ENGINE.0), &archive, ENGINE.2)?;
        core.voice.lock().unwrap().label = "Unpacking".into();
        let engine = root.join("engine");
        let _ = std::fs::remove_dir_all(&engine);
        unpack(&archive, &engine)?;
        let _ = std::fs::remove_file(&archive);
        if !exe(core).is_file() { bail!("The speech engine did not unpack correctly."); }
    }
    core.voice.lock().unwrap().label = v.label.into();
    let m = model(core, v.id);
    fetch(core, &format!("{VOICE_URL}{}/{}.onnx.json", v.path, v.id), &m.with_extension("onnx.json"), v.sha_json)?;
    fetch(core, &format!("{VOICE_URL}{}/{}.onnx", v.path, v.id), &m, v.sha)?;
    Ok(())
}

pub fn install(core: &Arc<Core>, id: &str) -> Result<Value> {
    let v = find(id)?;
    {
        let mut job = core.voice.lock().unwrap();
        if job.state == "downloading" { bail!("A voice download is already running."); }
        *job = VoiceJob { state: "downloading".into(), label: "Starting".into(), done: 0, total: v.size + if exe(core).is_file() { 0 } else { ENGINE.1 }, error: None };
    }
    let core2 = core.clone();
    std::thread::Builder::new().name("pu-voice".into()).spawn(move || {
        let result = install_blocking(&core2, v);
        let mut job = core2.voice.lock().unwrap();
        match result {
            Ok(()) => { job.state = "ready".into(); job.done = job.total; }
            Err(e) => { job.state = "error".into(); job.error = Some(format!("{e:#}")); }
        }
        drop(job);
        if installed(&core2, v.id) {
            let conn = core2.conn.lock().unwrap();
            let _ = conn.execute("INSERT INTO outbound_log(ts, target, summary, files) VALUES(?, 'github.com · huggingface.co', ?, '[]')",
                rusqlite::params![crate::db::now_ms(), format!("Downloaded ORION's natural voice ({}). A download only — nothing of yours was sent. Speech is now generated on this computer.", v.label)]);
        }
    })?;
    Ok(status(core))
}

pub fn remove(core: &Arc<Core>) -> Result<Value> {
    if core.voice.lock().unwrap().state == "downloading" { bail!("Wait for the download to finish first."); }
    let _ = std::fs::remove_dir_all(dir(core));
    *core.voice.lock().unwrap() = VoiceJob::default();
    Ok(status(core))
}

/// Text → WAV on disk (cached by voice + text). Returns the file path for the `pu://` protocol.
pub fn speak(core: &Arc<Core>, id: &str, text: &str) -> Result<Value> {
    find(id)?;
    if !installed(core, id) { bail!("That voice is not installed."); }
    let text: String = text.chars().filter(|c| !c.is_control()).take(2000).collect::<String>().replace(['·', '—', '–'], ", ").replace(['“', '”', '‘'], "").replace('’', "'");
    if text.trim().is_empty() { bail!("nothing to say"); }
    let cache = dir(core).join("cache");
    std::fs::create_dir_all(&cache)?;
    let key = blake3::hash(format!("{id}|{text}").as_bytes()).to_hex()[..24].to_string();
    let out = cache.join(format!("{key}.wav"));
    if !out.is_file() {
        let tmp = cache.join(format!("{key}.tmp.wav"));
        let mut cmd = Command::new(exe(core));
        cmd.arg("--model").arg(model(core, id)).arg("--output_file").arg(&tmp).arg("--sentence_silence").arg("0.28").arg("--length_scale").arg("1.04")
            .current_dir(exe(core).parent().unwrap()).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        { use std::os::windows::process::CommandExt; cmd.creation_flags(0x0800_0000); } // no console window
        let mut child = cmd.spawn().context("could not start the speech engine")?;
        child.stdin.take().ok_or_else(|| anyhow!("no stdin"))?.write_all(format!("{}\n", text.trim()).as_bytes())?;
        if !child.wait()?.success() || !tmp.is_file() { let _ = std::fs::remove_file(&tmp); bail!("The speech engine could not produce audio."); }
        std::fs::rename(&tmp, &out)?;
        // Keep the cache small: the 60 most recent clips.
        let mut clips: Vec<_> = std::fs::read_dir(&cache)?.flatten().filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path()))).collect();
        clips.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, p) in clips.into_iter().skip(60) { let _ = std::fs::remove_file(p); }
    }
    Ok(json!({ "path": out.to_string_lossy() }))
}
