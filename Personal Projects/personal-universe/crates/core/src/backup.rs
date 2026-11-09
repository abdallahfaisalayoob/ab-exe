//! Backup, restore and export. Backups are complete, consistent SQLite snapshots.

use crate::db::now_ms;
use crate::Core;
use anyhow::{anyhow, Result};
use serde_json::{json, Map, Value};
use std::sync::Arc;

fn stamp() -> String {
    chrono::Local::now().format("%Y-%m-%d_%H-%M-%S").to_string()
}

pub fn create(core: &Arc<Core>, label: &str) -> Result<Value> {
    let name = format!("universe_{}_{label}.db", stamp());
    let dest = core.data_dir.join("backups").join(&name);
    let conn = core.conn.lock().unwrap();
    conn.execute("VACUUM INTO ?", [dest.to_string_lossy()])?;
    let size = std::fs::metadata(&dest).map(|m| m.len()).unwrap_or(0);
    Ok(json!({ "name": name, "path": dest.to_string_lossy(), "size": size }))
}

pub fn list(core: &Arc<Core>) -> Result<Value> {
    let mut out = Vec::new();
    for e in std::fs::read_dir(core.data_dir.join("backups"))?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !name.ends_with(".db") {
            continue;
        }
        let md = e.metadata()?;
        let modified = md.modified().ok().and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_millis() as i64).unwrap_or(0);
        out.push(json!({ "name": name, "size": md.len(), "modified": modified, "path": e.path().to_string_lossy(),
                         "auto": name.contains("_auto"), "safety": name.contains("_before-restore") }));
    }
    out.sort_by_key(|v| -v["modified"].as_i64().unwrap_or(0));
    Ok(Value::Array(out))
}

/// One automatic snapshot per 20h, keeping the ten most recent automatic ones.
pub fn auto(core: &Arc<Core>) -> Result<()> {
    let existing = list(core)?;
    let autos: Vec<&Value> = existing.as_array().unwrap().iter().filter(|b| b["auto"].as_bool() == Some(true)).collect();
    let fresh = autos.first().map(|b| now_ms() - b["modified"].as_i64().unwrap_or(0) < 20 * 3600 * 1000).unwrap_or(false);
    let empty: i64 = core.conn.lock().unwrap().query_row(
        "SELECT (SELECT COUNT(*) FROM activity) + (SELECT COUNT(*) FROM files) + (SELECT COUNT(*) FROM transactions)", [], |r| r.get(0))?;
    if !fresh && empty > 0 {
        create(core, "auto")?;
    }
    for old in autos.iter().skip(9) {
        if let Some(p) = old["path"].as_str() {
            let _ = std::fs::remove_file(p);
        }
    }
    Ok(())
}

pub fn restore(core: &Arc<Core>, name: &str) -> Result<Value> {
    if name.contains(['/', '\\']) || !name.ends_with(".db") {
        return Err(anyhow!("invalid backup name"));
    }
    let src = core.data_dir.join("backups").join(name);
    if !src.is_file() {
        return Err(anyhow!("That backup file no longer exists."));
    }
    if core.busy() {
        return Err(anyhow!("Indexing is still running. Wait for it to finish, then restore."));
    }
    // Validate before touching anything.
    {
        let probe = rusqlite::Connection::open_with_flags(&src, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
        let ok: String = probe.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
        let has: i64 = probe.query_row("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('files','settings','transactions')", [], |r| r.get(0))?;
        if ok != "ok" || has < 3 {
            return Err(anyhow!("That file is not a healthy Personal Universe backup; nothing was changed."));
        }
    }
    // The current state is always saved first, so a restore can itself be undone.
    let safety = create(core, "before-restore")?;
    let mut conn = core.conn.lock().unwrap();
    conn.restore(rusqlite::MAIN_DB, &src, None::<fn(rusqlite::backup::Progress)>)?;
    crate::db::migrate(&mut conn)?;
    crate::db::log_activity(&conn, "archive", "restore", "Restored a backup", Some(name));
    Ok(json!({ "restored": name, "safety": safety["name"] }))
}

/// Human-readable export of everything the user created (not the file index).
pub fn export_json(core: &Arc<Core>) -> Result<Value> {
    let conn = core.conn.lock().unwrap();
    let tables = ["courses", "class_slots", "deadlines", "study_sessions", "prompts", "accounts", "transactions", "budgets", "goals",
                  "recurring", "projects", "milestones", "tasks", "notes", "tags", "links", "collections", "activity", "outbound_log", "settings"];
    let mut root = Map::new();
    root.insert("exported_at".into(), json!(chrono::Local::now().to_rfc3339()));
    root.insert("app".into(), json!("Personal Universe"));
    for t in tables {
        root.insert(t.into(), crate::db::query(&conn, &format!("SELECT * FROM {t}"), None)?);
    }
    let dest = core.data_dir.join("exports").join(format!("personal-universe_{}.json", stamp()));
    std::fs::write(&dest, serde_json::to_vec_pretty(&Value::Object(root))?)?;
    Ok(json!({ "path": dest.to_string_lossy(), "dir": core.data_dir.join("exports").to_string_lossy() }))
}
