//! AI handoff. Personal Universe never uploads anything itself: it prepares a folder with
//! the prompt and *copies* of the chosen files, and the user attaches them by hand.
//! Every preparation is written to the privacy ledger.

use crate::db::now_ms;
use crate::Core;
use anyhow::{anyhow, Result};
use serde_json::{json, Value};
use std::path::Path;
use std::sync::Arc;

const MAX_COPY: u64 = 200 * 1024 * 1024;

fn slug(s: &str) -> String {
    let t: String = s.chars().map(|c| if c.is_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let t = t.split('-').filter(|p| !p.is_empty()).collect::<Vec<_>>().join("-");
    t.chars().take(40).collect()
}

pub fn prepare(core: &Arc<Core>, args: &Value) -> Result<Value> {
    let prompt = args.get("prompt").and_then(|v| v.as_str()).ok_or_else(|| anyhow!("missing prompt"))?;
    let title = args.get("title").and_then(|v| v.as_str()).unwrap_or("handoff");
    let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("assistant");
    let include_text = args.get("includeText").and_then(|v| v.as_bool()).unwrap_or(false);
    let ids: Vec<i64> = serde_json::from_value(args.get("fileIds").cloned().unwrap_or(json!([])))?;

    let dir = core.data_dir.join("handoffs").join(format!("{}_{}", chrono::Local::now().format("%Y-%m-%d_%H-%M-%S"), slug(title)));
    std::fs::create_dir_all(&dir)?;
    std::fs::write(dir.join("PROMPT.md"), prompt)?;

    let conn = core.conn.lock().unwrap();
    let mut files = Vec::new();
    let mut combined = String::new();
    for id in ids {
        let row = conn.query_row("SELECT path, name, size FROM files WHERE id = ?", [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?)));
        let Ok((path, name, size)) = row else { continue };
        let src = Path::new(&path);
        let (status, copied) = if !src.is_file() {
            ("missing", None)
        } else if size as u64 > MAX_COPY {
            ("too-large", None)
        } else {
            // Never overwrite: disambiguate equal names from different folders.
            let mut dest = dir.join(&name);
            let mut n = 2;
            while dest.exists() {
                dest = dir.join(format!("{n}_{name}"));
                n += 1;
            }
            match std::fs::copy(src, &dest) {
                Ok(_) => ("copied", Some(dest.to_string_lossy().into_owned())),
                Err(_) => ("unreadable", None),
            }
        };
        if include_text {
            let body: String = conn.query_row("SELECT body FROM files_fts WHERE rowid = ?", [id], |r| r.get(0)).unwrap_or_default();
            if !body.trim().is_empty() {
                combined.push_str(&format!("\n\n===== {name} =====\n\n{body}"));
            }
        }
        files.push(json!({ "id": id, "name": name, "original": path, "status": status, "copy": copied, "size": size }));
    }
    let text_path = if include_text && !combined.is_empty() {
        let p = dir.join("EXTRACTED_TEXT.md");
        std::fs::write(&p, combined.trim_start())?;
        Some(p.to_string_lossy().into_owned())
    } else {
        None
    };
    let names: Vec<&str> = files.iter().filter_map(|f| f["name"].as_str()).collect();
    conn.execute(
        "INSERT INTO outbound_log(ts, target, summary, files, dir) VALUES(?,?,?,?,?)",
        rusqlite::params![now_ms(), target, format!("Prepared “{title}” — {} file(s). Nothing was uploaded by the app.", files.len()), serde_json::to_string(&names)?, dir.to_string_lossy()],
    )?;
    Ok(json!({ "dir": dir.to_string_lossy(), "promptPath": dir.join("PROMPT.md").to_string_lossy(), "textPath": text_path, "files": files }))
}
