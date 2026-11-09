//! Serves previews to the interface: original files (only ones that are in the index)
//! and cached thumbnails. Used by the `pu://` protocol in the desktop app.

use crate::Core;
use anyhow::{anyhow, Result};
use std::path::{Path, PathBuf};
use std::sync::Arc;

const MAX_SERVE: u64 = 300 * 1024 * 1024;

pub fn mime(path: &Path) -> &'static str {
    match path.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("svg") => "image/svg+xml",
        Some("ico") => "image/x-icon",
        Some("avif") => "image/avif",
        Some("pdf") => "application/pdf",
        Some("mp3") => "audio/mpeg",
        Some("wav") => "audio/wav",
        Some("ogg" | "opus") => "audio/ogg",
        Some("m4a") => "audio/mp4",
        Some("flac") => "audio/flac",
        Some("mp4" | "m4v") => "video/mp4",
        Some("webm") => "video/webm",
        _ => "application/octet-stream",
    }
}

fn allowed(core: &Core, path: &str) -> bool {
    if Path::new(path).starts_with(&core.data_dir) {
        return true;
    }
    core.conn.lock().unwrap().query_row("SELECT 1 FROM files WHERE path = ?", [path], |_| Ok(())).is_ok()
}

fn thumb(core: &Core, path: &Path) -> Result<PathBuf> {
    let md = std::fs::metadata(path)?;
    let stamp = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis()).unwrap_or(0);
    let key = blake3::hash(format!("{}|{}|{}", path.display(), md.len(), stamp).as_bytes()).to_hex()[..24].to_string();
    let dest = core.data_dir.join("thumbs").join(format!("{key}.jpg"));
    if !dest.exists() {
        let img = image::open(path)?.thumbnail(480, 480).to_rgb8();
        let tmp = dest.with_extension("tmp");
        img.save_with_format(&tmp, image::ImageFormat::Jpeg)?;
        std::fs::rename(&tmp, &dest)?;
    }
    Ok(dest)
}

/// `route` is "file" or "thumb". Returns the bytes and their content type.
pub fn serve(core: &Arc<Core>, route: &str, path: &str) -> Result<(Vec<u8>, &'static str)> {
    if !allowed(core, path) {
        return Err(anyhow!("not an indexed file"));
    }
    let p = Path::new(path);
    let target = match route {
        "thumb" => match p.extension().map(|e| e.to_string_lossy().to_lowercase()).as_deref() {
            // Vector and exotic formats are sent as they are.
            Some("svg" | "ico" | "avif") => p.to_path_buf(),
            _ => thumb(core, p)?,
        },
        _ => p.to_path_buf(),
    };
    if std::fs::metadata(&target)?.len() > MAX_SERVE {
        return Err(anyhow!("file too large to preview"));
    }
    let m = if route == "thumb" && target != p { "image/jpeg" } else { mime(&target) };
    Ok((std::fs::read(&target)?, m))
}

/// Percent-decoding for the `path=` query parameter.
pub fn decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = if bytes[i] == b'%' && i + 2 < bytes.len() {
            std::str::from_utf8(&bytes[i + 1..i + 3]).ok().and_then(|h| u8::from_str_radix(h, 16).ok())
        } else {
            None
        };
        match hex {
            Some(b) => {
                out.push(b);
                i += 3;
            }
            None => {
                out.push(bytes[i]);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Splits "route?path=…" (as used by both the protocol handler and the dev bridge).
pub fn parse_query(query: &str) -> String {
    query.split('&').find_map(|kv| kv.strip_prefix("path=")).map(decode).unwrap_or_default()
}
