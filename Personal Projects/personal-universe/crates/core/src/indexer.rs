//! Folder ingestion and incremental indexing.
//!
//! Rules this module never breaks:
//!  * source files are opened read-only — nothing is moved, renamed, deleted or rewritten;
//!  * a file whose size and modified-time are unchanged is not processed again;
//!  * all heavy work happens on a background thread, reporting progress through `Job`.

use crate::db::{self, now_ms};
use crate::extract;
use crate::Core;
use anyhow::{anyhow, Result};
use rayon::prelude::*;
use rusqlite::{params, Connection};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::UNIX_EPOCH;

const SKIP_DIRS: &[&str] = &[".git", "node_modules", "__pycache__", ".venv", "venv", "$RECYCLE.BIN", "System Volume Information", ".svn", ".idea", ".cache"];
const FULL_HASH_LIMIT: u64 = 32 * 1024 * 1024;
const CHUNK: usize = 48;

#[derive(Clone, Serialize, Default)]
pub struct Job {
    pub id: u64,
    pub label: String,
    pub state: String, // scanning | indexing | done | error | cancelled
    pub total: usize,
    pub done: usize,
    pub added: usize,
    pub updated: usize,
    pub unchanged: usize,
    pub missing: usize,
    pub skipped: usize,
    pub current: String,
    pub error: Option<String>,
    pub collection_id: i64,
    pub finished_at: Option<i64>,
    #[serde(skip)]
    pub cancel: bool,
}

struct Entry {
    path: String,
    parent: String,
    name: String,
    ext: String,
    size: u64,
    mtime: i64,
    ctime: i64,
}

struct Indexed {
    e: Entry,
    kind: &'static str,
    hash: Option<String>,
    text: Option<String>,
    excerpt: String,
    meta: String,
    terms: Vec<(String, f64)>,
}

fn ms(t: std::io::Result<std::time::SystemTime>) -> i64 {
    t.ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn entry_for(path: &Path) -> Option<Entry> {
    let md = std::fs::metadata(path).ok()?;
    if !md.is_file() {
        return None;
    }
    let name = path.file_name()?.to_string_lossy().into_owned();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| {
        let l = name.to_lowercase();
        if l == "makefile" || l == "cmakelists.txt" { "makefile".into() } else { String::new() }
    });
    Some(Entry {
        path: path.to_string_lossy().into_owned(),
        parent: path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default(),
        name,
        ext,
        size: md.len(),
        mtime: ms(md.modified()),
        ctime: ms(md.created()),
    })
}

/// Content fingerprint for duplicate detection. Small files are hashed whole; very large
/// ones by size + head + tail so a folder of videos does not take minutes to import.
fn fingerprint(path: &Path, size: u64) -> Option<String> {
    if size == 0 {
        return None;
    }
    let mut f = std::fs::File::open(path).ok()?;
    let mut hasher = blake3::Hasher::new();
    if size <= FULL_HASH_LIMIT {
        std::io::copy(&mut f, &mut hasher).ok()?;
    } else {
        hasher.update(&size.to_le_bytes());
        let mut buf = vec![0u8; 1024 * 1024];
        let n = f.read(&mut buf).ok()?;
        hasher.update(&buf[..n]);
        f.seek(SeekFrom::End(-(buf.len() as i64))).ok()?;
        let n = f.read(&mut buf).ok()?;
        hasher.update(&buf[..n]);
    }
    Some(hasher.finalize().to_hex()[..32].to_string())
}

fn process(e: Entry) -> Indexed {
    let path = PathBuf::from(&e.path);
    let kind = extract::kind_for_ext(&e.ext);
    let ex = extract::extract(&path, &e.ext, e.size);
    let hash = fingerprint(&path, e.size);
    let (excerpt, terms) = match &ex.text {
        Some(t) => (extract::excerpt(t), extract::top_terms(t, 12)),
        None => (String::new(), vec![]),
    };
    Indexed { e, kind, hash, text: ex.text, excerpt, meta: ex.meta.to_string(), terms }
}

fn with_job(core: &Core, id: u64, f: impl FnOnce(&mut Job)) -> bool {
    let mut jobs = core.jobs.lock().unwrap();
    match jobs.iter_mut().find(|j| j.id == id) {
        Some(j) => {
            f(j);
            j.cancel
        }
        None => false,
    }
}

fn ensure_collection(conn: &Connection, root: &str, name: &str, kind: &str, watched: bool) -> Result<i64> {
    conn.execute(
        "INSERT INTO collections(name, root_path, kind, watched, created_at) VALUES(?,?,?,?,?)
         ON CONFLICT(root_path) DO UPDATE SET watched = MAX(watched, excluded.watched)",
        params![name, root, kind, watched as i64, now_ms()],
    )?;
    Ok(conn.query_row("SELECT id FROM collections WHERE root_path = ?", [root], |r| r.get(0))?)
}

fn dir_prefix(root: &str) -> String {
    let sep = if root.contains('\\') { '\\' } else { '/' };
    if root.ends_with(sep) { root.to_string() } else { format!("{root}{sep}") }
}

/// Entry point for drops, the import dialog and watched-folder rescans.
pub fn import(core: &Arc<Core>, paths: Vec<String>, watched: bool, inbox: bool) -> Result<Value> {
    let mut notices: Vec<String> = Vec::new();
    let mut job_ids = Vec::new();
    let mut loose: Vec<PathBuf> = Vec::new();
    let mut dirs: Vec<(i64, PathBuf, String)> = Vec::new();
    {
        let conn = core.conn.lock().unwrap();
        for p in paths {
            let path = PathBuf::from(&p);
            let Ok(md) = std::fs::metadata(&path) else {
                notices.push(format!("Not found, skipped: {p}"));
                continue;
            };
            if md.is_file() || inbox {
                loose.push(path);
                continue;
            }
            let root = path.to_string_lossy().trim_end_matches(['/', '\\']).to_string();
            let root = if root.is_empty() { p.clone() } else { root };
            // Already covered by a parent collection? Then importing again would only split it.
            let parent: Option<String> = {
                let mut stmt = conn.prepare("SELECT name, root_path FROM collections WHERE kind = 'folder'")?;
                let rows: Vec<(String, String)> = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.flatten().collect();
                rows.into_iter().find(|(_, r)| r != &root && root.starts_with(&dir_prefix(r))).map(|(n, _)| n)
            };
            if let Some(n) = parent {
                notices.push(format!("“{}” is already inside the collection “{n}” — nothing to import.", path.file_name().map(|s| s.to_string_lossy()).unwrap_or_default()));
                continue;
            }
            let name = path.file_name().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| root.clone());
            let id = ensure_collection(&conn, &root, &name, "folder", watched)?;
            // Collections nested inside the new one are absorbed into it.
            let absorbed = conn.execute(
                "DELETE FROM collections WHERE kind = 'folder' AND id != ?1 AND substr(root_path, 1, length(?2)) = ?2",
                params![id, dir_prefix(&root)],
            );
            if let Ok(n) = absorbed {
                if n > 0 {
                    notices.push(format!("{n} nested collection(s) were merged into “{name}”."));
                }
            }
            dirs.push((id, path, name));
        }
        if !loose.is_empty() {
            let (root, name, kind) = if inbox { ("::inbox", "Inbox", "inbox") } else { ("::loose", "Loose files", "loose") };
            let id = ensure_collection(&conn, root, name, kind, false)?;
            job_ids.push(spawn(core, id, name.to_string(), Source::Paths(loose, inbox)));
        }
    }
    for (id, path, name) in dirs {
        job_ids.push(spawn(core, id, name, Source::Folder(path)));
    }
    Ok(json!({ "jobs": job_ids, "notices": notices }))
}

/// Re-checks existing collections (all watched ones, or a specific one).
pub fn rescan(core: &Arc<Core>, collection: Option<i64>) -> Result<Value> {
    let list: Vec<(i64, String, String, String)> = {
        let conn = core.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, name, root_path, kind FROM collections WHERE (?1 IS NULL AND watched = 1) OR id = ?1")?;
        let rows = stmt.query_map([collection], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?;
        rows.flatten().collect()
    };
    let mut ids = Vec::new();
    for (id, name, root, kind) in list {
        let src = if kind == "folder" { Source::Folder(PathBuf::from(root)) } else { Source::Recheck };
        ids.push(spawn(core, id, name, src));
    }
    Ok(json!({ "jobs": ids }))
}

enum Source {
    Folder(PathBuf),
    Paths(Vec<PathBuf>, bool),
    Recheck,
}

fn spawn(core: &Arc<Core>, collection_id: i64, label: String, src: Source) -> u64 {
    let id = core.job_seq.fetch_add(1, Ordering::SeqCst);
    {
        let mut jobs = core.jobs.lock().unwrap();
        jobs.retain(|j| j.finished_at.map(|t| now_ms() - t < 60_000).unwrap_or(true));
        jobs.push(Job { id, label, state: "queued".into(), collection_id, ..Default::default() });
    }
    let core = core.clone();
    std::thread::Builder::new()
        .name("pu-indexer".into())
        .spawn(move || {
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&core, id, collection_id, src)));
            let err = match result {
                Ok(Ok(())) => None,
                Ok(Err(e)) => Some(format!("{e:#}")),
                Err(_) => Some("The indexer hit an unexpected error and stopped safely.".to_string()),
            };
            with_job(&core, id, |j| {
                j.finished_at = Some(now_ms());
                j.current.clear();
                if let Some(e) = err {
                    j.state = "error".into();
                    j.error = Some(e);
                } else if j.cancel {
                    j.state = "cancelled".into();
                } else {
                    j.state = "done".into();
                }
            });
        })
        .expect("spawn indexer thread");
    id
}

fn walk(root: &Path, core: &Core, job: u64) -> Vec<Entry> {
    let mut out = Vec::new();
    let walker = walkdir::WalkDir::new(root).follow_links(false).into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        // Dependency folders, VCS internals and tagged cache directories (build outputs) are noise.
        !(e.file_type().is_dir() && e.depth() > 0 && (SKIP_DIRS.iter().any(|s| name.eq_ignore_ascii_case(s)) || e.path().join("CACHEDIR.TAG").exists()))
    });
    for item in walker.flatten() {
        if !item.file_type().is_file() {
            continue;
        }
        let name = item.file_name().to_string_lossy();
        if name == "Thumbs.db" || name == "desktop.ini" || name == ".DS_Store" || name.starts_with("~$") {
            continue;
        }
        if let Some(e) = entry_for(item.path()) {
            out.push(e);
        }
        if out.len() % 500 == 0 && with_job(core, job, |j| j.total = out.len()) {
            break;
        }
    }
    out
}

fn run(core: &Arc<Core>, job: u64, collection_id: i64, src: Source) -> Result<()> {
    // One indexing job at a time: jobs queue up instead of competing for the disk and the database.
    let _turn = core.index_turn.lock().unwrap_or_else(|p| p.into_inner());
    let mut conn = db::open(&core.db_path)?;
    let now = now_ms();
    let ocr: Option<String> = conn.query_row("SELECT value FROM settings WHERE key = 'ocr'", [], |r| r.get(0)).ok();
    crate::ocr::ENABLED.store(ocr.as_deref() != Some("false"), Ordering::Relaxed);

    // What do we already know about?
    struct Known {
        id: i64,
        size: i64,
        mtime: i64,
        collection: i64,
        missing: bool,
        indexed: bool,
    }
    let load_known = |conn: &Connection, sql: &str, p: &[&dyn rusqlite::ToSql]| -> Result<HashMap<String, Known>> {
        let mut stmt = conn.prepare(sql)?;
        let rows = stmt.query_map(p, |r| {
            Ok((
                r.get::<_, String>(0)?,
                Known { id: r.get(1)?, size: r.get(2)?, mtime: r.get(3)?, collection: r.get(4)?, missing: r.get::<_, i64>(5)? != 0, indexed: r.get::<_, Option<i64>>(6)?.is_some() },
            ))
        })?;
        Ok(rows.flatten().collect())
    };
    const COLS: &str = "SELECT path, id, size, mtime, collection_id, missing, indexed_at FROM files";

    with_job(core, job, |j| j.state = "scanning".into());
    let (entries, known, inbox, full_scan): (Vec<Entry>, HashMap<String, Known>, bool, bool) = match src {
        Source::Folder(root) => {
            if !root.is_dir() {
                return Err(anyhow!("The folder {} is not reachable right now. Its files were left untouched in the index.", root.display()));
            }
            let entries = walk(&root, core, job);
            let prefix = dir_prefix(&root.to_string_lossy());
            let known = load_known(&conn, &format!("{COLS} WHERE collection_id = ?1 OR substr(path, 1, length(?2)) = ?2"), &[&collection_id, &prefix])?;
            (entries, known, false, true)
        }
        Source::Paths(paths, inbox) => {
            let mut entries = Vec::new();
            for p in paths {
                if p.is_dir() {
                    entries.extend(walk(&p, core, job));
                } else if let Some(e) = entry_for(&p) {
                    entries.push(e);
                }
            }
            let mut known = HashMap::new();
            for chunk in entries.chunks(400) {
                let marks = vec!["?"; chunk.len()].join(",");
                let args: Vec<&dyn rusqlite::ToSql> = chunk.iter().map(|e| &e.path as &dyn rusqlite::ToSql).collect();
                known.extend(load_known(&conn, &format!("{COLS} WHERE path IN ({marks})"), &args)?);
            }
            (entries, known, inbox, false)
        }
        Source::Recheck => {
            let known = load_known(&conn, &format!("{COLS} WHERE collection_id = ?1"), &[&collection_id])?;
            let entries = known.keys().filter_map(|p| entry_for(Path::new(p))).collect();
            (entries, known, false, true)
        }
    };

    let seen: HashSet<&str> = entries.iter().map(|e| e.path.as_str()).collect();
    let gone: Vec<i64> = if full_scan {
        known.iter().filter(|(p, k)| k.collection == collection_id && !k.missing && !seen.contains(p.as_str())).map(|(_, k)| k.id).collect()
    } else {
        vec![]
    };
    drop(seen);

    // Split into work that needs extraction and rows that only need a touch.
    let mut todo = Vec::new();
    let mut touch: Vec<i64> = Vec::new();
    let (mut unchanged, mut skipped) = (0usize, 0usize);
    for e in entries {
        match known.get(&e.path) {
            // Dropping something into the inbox that already lives in the library is a no-op.
            Some(k) if inbox && k.collection != collection_id => skipped += 1,
            Some(k) if k.indexed && k.size == e.size as i64 && k.mtime == e.mtime => {
                unchanged += 1;
                if k.missing || k.collection != collection_id {
                    touch.push(k.id);
                }
            }
            _ => todo.push(e),
        }
    }
    with_job(core, job, |j| {
        j.state = "indexing".into();
        j.total = todo.len();
        j.unchanged = unchanged;
        j.skipped = skipped;
        j.missing = gone.len();
    });

    {
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        for id in &touch {
            tx.execute("UPDATE files SET missing = 0, collection_id = ? WHERE id = ?", params![collection_id, id])?;
        }
        for id in &gone {
            tx.execute("UPDATE files SET missing = 1 WHERE id = ?", [id])?;
        }
        tx.commit()?;
    }

    let known_ids: HashMap<String, i64> = known.into_iter().map(|(p, k)| (p, k.id)).collect();
    let (mut added, mut updated, mut done) = (0usize, 0usize, 0usize);
    let mut iter = todo.into_iter().peekable();
    while iter.peek().is_some() {
        let chunk: Vec<Entry> = iter.by_ref().take(CHUNK).collect();
        let first = chunk.first().map(|e| e.name.clone()).unwrap_or_default();
        if with_job(core, job, |j| j.current = first) {
            break;
        }
        let processed: Vec<Indexed> = chunk.into_par_iter().map(process).collect();
        let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        {
            let mut up = tx.prepare_cached(
                "INSERT INTO files(collection_id, path, parent, name, ext, kind, size, mtime, ctime, imported_at, indexed_at, hash, text_len, excerpt, meta, missing, inbox_state)
                 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?10,?11,?12,?13,?14,0,?15)
                 ON CONFLICT(path) DO UPDATE SET collection_id = excluded.collection_id, parent = excluded.parent, name = excluded.name,
                   ext = excluded.ext, kind = excluded.kind, size = excluded.size, mtime = excluded.mtime, ctime = excluded.ctime,
                   indexed_at = excluded.indexed_at, hash = excluded.hash, text_len = excluded.text_len, excerpt = excluded.excerpt,
                   meta = excluded.meta, missing = 0
                 RETURNING id",
            )?;
            let mut del_fts = tx.prepare_cached("DELETE FROM files_fts WHERE rowid = ?")?;
            let mut ins_fts = tx.prepare_cached("INSERT INTO files_fts(rowid, name, body) VALUES(?,?,?)")?;
            let mut del_terms = tx.prepare_cached("DELETE FROM file_terms WHERE file_id = ?")?;
            let mut ins_term = tx.prepare_cached("INSERT OR REPLACE INTO file_terms(file_id, term, weight) VALUES(?,?,?)")?;
            for f in &processed {
                let existed = known_ids.contains_key(&f.e.path);
                let text_len = f.text.as_ref().map(|t| t.len()).unwrap_or(0) as i64;
                let id: i64 = up.query_row(
                    params![collection_id, f.e.path, f.e.parent, f.e.name, f.e.ext, f.kind, f.e.size as i64, f.e.mtime, f.e.ctime, now, f.hash, text_len, f.excerpt, f.meta, if inbox { Some("new") } else { None }],
                    |r| r.get(0),
                )?;
                del_fts.execute([id])?;
                ins_fts.execute(params![id, f.e.name, f.text.as_deref().unwrap_or("")])?;
                del_terms.execute([id])?;
                for (term, w) in &f.terms {
                    ins_term.execute(params![id, term, w])?;
                }
                if existed { updated += 1 } else { added += 1 }
            }
        }
        tx.commit()?;
        done += processed.len();
        with_job(core, job, |j| {
            j.done = done;
            j.added = added;
            j.updated = updated;
        });
    }

    conn.execute("UPDATE collections SET last_scan_at = ? WHERE id = ?", params![now_ms(), collection_id])?;
    if added + updated + gone.len() > 0 {
        let name: String = conn.query_row("SELECT name FROM collections WHERE id = ?", [collection_id], |r| r.get(0)).unwrap_or_default();
        let mut parts = Vec::new();
        if added > 0 {
            parts.push(format!("{added} new"));
        }
        if updated > 0 {
            parts.push(format!("{updated} changed"));
        }
        if !gone.is_empty() {
            parts.push(format!("{} no longer on disk", gone.len()));
        }
        conn.execute(
            "INSERT INTO activity(ts, world, kind, title, ref_type, ref_id, detail) VALUES(?,?,?,?,?,?,?)",
            params![now_ms(), "knowledge", if inbox { "inbox" } else { "import" }, format!("Indexed “{name}”"), "collection", collection_id, parts.join(" · ")],
        )?;
    }
    Ok(())
}

/// Queues images and text-less PDFs for another pass, so text recognition can read files that
/// were indexed before it was available. Returns how many files will be re-read.
pub fn reocr(core: &Arc<Core>) -> Result<Value> {
    let (n, ids): (usize, Vec<i64>) = {
        let conn = core.conn.lock().unwrap();
        let n = conn.execute("UPDATE files SET indexed_at = NULL WHERE missing = 0 AND text_len < 40 AND (kind = 'image' OR ext = 'pdf')", [])?;
        let mut stmt = conn.prepare("SELECT DISTINCT collection_id FROM files WHERE indexed_at IS NULL")?;
        let ids = stmt.query_map([], |r| r.get(0))?.flatten().collect();
        (n, ids)
    };
    let mut jobs = Vec::new();
    for id in ids {
        jobs.extend(rescan(core, Some(id))?["jobs"].as_array().cloned().unwrap_or_default());
    }
    Ok(json!({ "files": n, "jobs": jobs, "available": crate::ocr::available() }))
}
