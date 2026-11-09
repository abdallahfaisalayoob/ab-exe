//! Local document processing: turns files into searchable text + light metadata.
//! Nothing here touches the network, and nothing ever writes to the source file.

use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs::File;
use std::io::Read;
use std::path::Path;

pub const MAX_TEXT_CHARS: usize = 400_000;
const MAX_TEXT_FILE: u64 = 3 * 1024 * 1024;
const MAX_DOC_FILE: u64 = 80 * 1024 * 1024;

pub struct Extracted {
    pub text: Option<String>,
    pub meta: Value,
}

pub fn kind_for_ext(ext: &str) -> &'static str {
    match ext {
        "pdf" | "docx" | "doc" | "txt" | "md" | "markdown" | "rtf" | "odt" | "tex" | "epub" => "doc",
        "xlsx" | "xls" | "xlsm" | "csv" | "tsv" | "ods" => "sheet",
        "pptx" | "ppt" | "key" | "odp" => "slides",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" | "tif" | "tiff" | "heic" | "avif" => "image",
        "mp4" | "mkv" | "mov" | "avi" | "webm" | "wmv" | "m4v" | "flv" => "video",
        "mp3" | "wav" | "flac" | "m4a" | "ogg" | "aac" | "wma" | "opus" => "audio",
        "c" | "h" | "cpp" | "hpp" | "cc" | "cxx" | "cs" | "java" | "kt" | "py" | "ipynb" | "js" | "jsx" | "ts"
        | "tsx" | "mjs" | "rs" | "go" | "rb" | "php" | "swift" | "sh" | "bash" | "ps1" | "bat" | "cmd" | "sql"
        | "html" | "htm" | "css" | "scss" | "lua" | "r" | "pl" | "dart" | "vue" | "svelte" | "makefile" | "cmake" => "code",
        "m" | "mlx" | "slx" | "mat" | "asm" | "s" | "v" | "sv" | "vhd" | "vhdl" | "ino" | "sch" | "brd" | "kicad_pcb"
        | "kicad_sch" | "kicad_pro" | "ltspice" | "asc" | "cir" | "net" | "spice" | "stl" | "step" | "stp" | "dwg"
        | "dxf" | "gbr" | "gcode" | "nc" | "hex" | "elf" | "lib" | "ucf" | "xdc" | "tcl" | "pdsprj" | "ms14" => "eng",
        "json" | "xml" | "yaml" | "yml" | "toml" | "ini" | "cfg" | "conf" | "env" | "log" | "db" | "sqlite" | "parquet" => "data",
        "zip" | "rar" | "7z" | "tar" | "gz" | "bz2" | "xz" | "iso" => "archive",
        _ => "other",
    }
}

fn is_plain_text(ext: &str, kind: &str) -> bool {
    if matches!(ext, "txt" | "md" | "markdown" | "csv" | "tsv" | "tex" | "rtf" | "svg") {
        return true;
    }
    match kind {
        "code" => true,
        "data" => !matches!(ext, "db" | "sqlite" | "parquet"),
        "eng" => matches!(
            ext,
            "m" | "asm" | "s" | "v" | "sv" | "vhd" | "vhdl" | "ino" | "cir" | "net" | "spice" | "asc" | "gcode" | "nc"
                | "tcl" | "ucf" | "xdc" | "kicad_sch" | "kicad_pcb" | "kicad_pro" | "dxf"
        ),
        _ => false,
    }
}

pub fn extract(path: &Path, ext: &str, size: u64) -> Extracted {
    let kind = kind_for_ext(ext);
    let mut meta = json!({});
    let text = if is_plain_text(ext, kind) {
        read_text(path, size)
    } else {
        match ext {
            "pdf" if size <= MAX_DOC_FILE => pdf_text(path),
            "docx" if size <= MAX_DOC_FILE => docx_text(path),
            "pptx" if size <= MAX_DOC_FILE => {
                let (t, slides) = pptx_text(path);
                if slides > 0 {
                    meta["slides"] = json!(slides);
                }
                t
            }
            "xlsx" | "xls" | "xlsm" | "ods" if size <= MAX_DOC_FILE => sheet_text(path, &mut meta),
            _ => None,
        }
    };
    if kind == "image" && !matches!(ext, "svg" | "heic" | "avif" | "tif" | "tiff" | "ico") {
        if let Ok((w, h)) = image::image_dimensions(path) {
            meta["width"] = json!(w);
            meta["height"] = json!(h);
        }
    }
    let text = text.map(clean).filter(|t| !t.is_empty());
    Extracted { text, meta }
}

fn clean(t: String) -> String {
    let mut out = String::with_capacity(t.len().min(MAX_TEXT_CHARS));
    let mut blank = 0;
    for line in t.lines() {
        let line = line.trim_end();
        if line.trim().is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }
        if out.len() + line.len() > MAX_TEXT_CHARS {
            break;
        }
        out.push_str(line);
        out.push('\n');
    }
    out.trim().to_string()
}

fn read_text(path: &Path, size: u64) -> Option<String> {
    let mut buf = Vec::new();
    File::open(path).ok()?.take(MAX_TEXT_FILE.min(size.max(1))).read_to_end(&mut buf).ok()?;
    // A burst of NUL bytes means this is binary wearing a text extension.
    if buf.iter().take(4096).filter(|b| **b == 0).count() > 8 {
        return None;
    }
    Some(String::from_utf8_lossy(&buf).into_owned())
}

fn pdf_text(path: &Path) -> Option<String> {
    let p = path.to_path_buf();
    // pdf-extract can panic on malformed files; a bad PDF must never take the indexer down.
    std::panic::catch_unwind(move || pdf_extract::extract_text(&p).ok()).ok().flatten()
}

fn zip_entry(archive: &mut zip::ZipArchive<File>, name: &str) -> Option<String> {
    let f = archive.by_name(name).ok()?;
    let mut s = String::new();
    f.take(40 * 1024 * 1024).read_to_string(&mut s).ok()?;
    Some(s)
}

/// Strips XML to text, turning the given closing tags into line breaks.
fn xml_text(xml: &str, breaks: &[&str]) -> String {
    let mut out = String::with_capacity(xml.len() / 4);
    let mut rest = xml;
    while let Some(lt) = rest.find('<') {
        push_unescaped(&mut out, &rest[..lt]);
        let Some(gt) = rest[lt..].find('>') else { break };
        let tag = &rest[lt + 1..lt + gt];
        if breaks.iter().any(|b| tag == *b) {
            out.push('\n');
        } else if tag.starts_with("w:tab") || tag.starts_with("a:tab") {
            out.push('\t');
        }
        rest = &rest[lt + gt + 1..];
    }
    out
}

fn push_unescaped(out: &mut String, s: &str) {
    if !s.contains('&') {
        out.push_str(s);
        return;
    }
    out.push_str(&s.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"").replace("&apos;", "'").replace("&amp;", "&"));
}

fn docx_text(path: &Path) -> Option<String> {
    let mut z = zip::ZipArchive::new(File::open(path).ok()?).ok()?;
    let xml = zip_entry(&mut z, "word/document.xml")?;
    Some(xml_text(&xml, &["/w:p", "w:br/", "/w:tr"]))
}

fn pptx_text(path: &Path) -> (Option<String>, usize) {
    let Some(mut z) = File::open(path).ok().and_then(|f| zip::ZipArchive::new(f).ok()) else {
        return (None, 0);
    };
    let mut slides: Vec<(u32, String)> = z
        .file_names()
        .flatten()
        .map(|n| n.to_string())
        .filter(|n| n.starts_with("ppt/slides/slide") && n.ends_with(".xml"))
        .filter_map(|n| {
            let num = n.trim_start_matches("ppt/slides/slide").trim_end_matches(".xml").parse().ok()?;
            Some((num, n.to_string()))
        })
        .collect();
    slides.sort();
    let mut out = String::new();
    for (num, name) in &slides {
        if let Some(xml) = zip_entry(&mut z, name) {
            out.push_str(&format!("— Slide {num} —\n"));
            out.push_str(xml_text(&xml, &["/a:p"]).trim());
            out.push_str("\n\n");
        }
    }
    (Some(out), slides.len())
}

fn sheet_text(path: &Path, meta: &mut Value) -> Option<String> {
    let sheets = crate::grid::read_sheets(path, 2000).ok()?;
    meta["sheets"] = json!(sheets.iter().map(|s| s.name.clone()).collect::<Vec<_>>());
    let mut out = String::new();
    for s in sheets.iter().take(8) {
        out.push_str(&format!("— {} —\n", s.name));
        for row in &s.rows {
            let line = row.iter().filter(|c| !c.is_empty()).cloned().collect::<Vec<_>>().join(" · ");
            if !line.is_empty() {
                out.push_str(&line);
                out.push('\n');
            }
            if out.len() > MAX_TEXT_CHARS {
                return Some(out);
            }
        }
    }
    Some(out)
}

const STOP: &str = "about above after again against also although always among another around because been before being below between both cannot could does doing done down during each either else ever every from further have having here hers herself himself however into itself just less like made make many more most much must myself never next none nothing only onto other others ought ours ourselves over same shall should since some such than that their theirs them themselves then there these they this those through thus under until upon very were what when where whether which while whom whose will with within without would your yours yourself using used uses given page figure table chapter section http https www com true false null void return include define class public private static const int float double char string print println import function endif else elif then begin end note notes slide example examples following shown show value values number data type types name names file files first second third one two three four five six seven eight nine ten can may let get set new use see";

fn stopwords() -> &'static std::collections::HashSet<&'static str> {
    static S: std::sync::OnceLock<std::collections::HashSet<&'static str>> = std::sync::OnceLock::new();
    S.get_or_init(|| STOP.split_whitespace().collect())
}

/// The most characteristic terms of a text: plain term frequency over a stop-list,
/// with a mild bonus for longer words. Deliberately simple and explainable.
pub fn top_terms(text: &str, n: usize) -> Vec<(String, f64)> {
    let stop = stopwords();
    let mut counts: HashMap<String, u32> = HashMap::new();
    let mut total = 0u32;
    for word in text.split(|c: char| !c.is_alphabetic()).take(120_000) {
        let len = word.chars().count();
        if !(4..=24).contains(&len) {
            continue;
        }
        let w = word.to_lowercase();
        if stop.contains(w.as_str()) {
            continue;
        }
        total += 1;
        *counts.entry(w).or_insert(0) += 1;
    }
    if total < 12 {
        return vec![];
    }
    let mut scored: Vec<(String, f64)> = counts
        .into_iter()
        .filter(|(_, c)| *c >= 2)
        .map(|(w, c)| {
            let bonus = 1.0 + (w.chars().count() as f64 - 4.0).min(6.0) * 0.06;
            (w, (c as f64 / total as f64) * bonus)
        })
        .collect();
    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal).then(a.0.cmp(&b.0)));
    scored.truncate(n);
    scored
}

pub fn excerpt(text: &str) -> String {
    let mut out = String::new();
    for part in text.split_whitespace() {
        if out.len() + part.len() > 420 {
            out.push('…');
            break;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(part);
    }
    out
}
