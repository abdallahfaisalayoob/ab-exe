//! Personal Universe core. One process, one local SQLite file, no network.
//!
//! The desktop shell (Tauri) and the development bridge (`pu-dev`) both talk to this
//! crate through `dispatch`, so the interface exercises exactly the same code in both.

pub mod backup;
pub mod db;
pub mod extract;
pub mod grid;
pub mod handoff;
pub mod indexer;
pub mod serve;
pub mod voice;

use anyhow::{anyhow, Result};
use rusqlite::Connection;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};

pub struct Core {
    pub data_dir: PathBuf,
    pub db_path: PathBuf,
    pub conn: Mutex<Connection>,
    pub jobs: Mutex<Vec<indexer::Job>>,
    pub job_seq: AtomicU64,
    pub index_turn: Mutex<()>,
    pub voice: Mutex<voice::VoiceJob>,
}

impl Core {
    pub fn open(data_dir: &Path) -> Result<Arc<Core>> {
        std::fs::create_dir_all(data_dir)?;
        for sub in ["backups", "thumbs", "handoffs", "exports"] {
            std::fs::create_dir_all(data_dir.join(sub))?;
        }
        let db_path = data_dir.join("universe.db");
        let mut conn = db::open(&db_path)?;
        db::migrate(&mut conn)?;
        let core = Arc::new(Core { data_dir: data_dir.to_path_buf(), db_path, conn: Mutex::new(conn), jobs: Mutex::new(Vec::new()), job_seq: AtomicU64::new(1), index_turn: Mutex::new(()), voice: Mutex::new(voice::VoiceJob::default()) });
        // A quiet safety net: one automatic backup per day, pruned to the latest ten.
        let _ = backup::auto(&core);
        Ok(core)
    }

    pub fn busy(&self) -> bool {
        self.jobs.lock().unwrap().iter().any(|j| j.finished_at.is_none())
    }
}

fn s<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args.get(key).and_then(|v| v.as_str()).ok_or_else(|| anyhow!("missing argument “{key}”"))
}

pub fn dispatch(core: &Arc<Core>, cmd: &str, args: &Value) -> Result<Value> {
    match cmd {
        "db.query" => db::query(&core.conn.lock().unwrap(), s(args, "sql")?, args.get("params")),
        "db.exec" => db::exec(&core.conn.lock().unwrap(), s(args, "sql")?, args.get("params")),
        "db.batch" => db::batch(&mut core.conn.lock().unwrap(), args.get("stmts").unwrap_or(&Value::Null)),

        "files.import" => {
            let paths: Vec<String> = serde_json::from_value(args.get("paths").cloned().unwrap_or(json!([])))?;
            let flag = |k: &str| args.get(k).and_then(|v| v.as_bool()).unwrap_or(false);
            indexer::import(core, paths, flag("watched"), flag("inbox"))
        }
        "files.rescan" => indexer::rescan(core, args.get("collection").and_then(|v| v.as_i64())),
        "files.text" => {
            let id = args.get("id").and_then(|v| v.as_i64()).ok_or_else(|| anyhow!("missing id"))?;
            let max = args.get("max").and_then(|v| v.as_u64()).unwrap_or(60_000) as usize;
            let conn = core.conn.lock().unwrap();
            let body: String = conn.query_row("SELECT body FROM files_fts WHERE rowid = ?", [id], |r| r.get(0)).unwrap_or_default();
            let cut = body.char_indices().nth(max).map(|(i, _)| i).unwrap_or(body.len());
            Ok(json!({ "text": &body[..cut], "truncated": cut < body.len() }))
        }
        "files.check" => {
            // Is the original still where we last saw it?
            let path = s(args, "path")?;
            let exists = Path::new(path).is_file();
            core.conn.lock().unwrap().execute("UPDATE files SET missing = ? WHERE path = ?", rusqlite::params![!exists as i64, path])?;
            Ok(json!({ "exists": exists }))
        }
        "jobs.status" => Ok(serde_json::to_value(&*core.jobs.lock().unwrap())?),
        "jobs.cancel" => {
            let id = args.get("id").and_then(|v| v.as_u64()).unwrap_or(0);
            for j in core.jobs.lock().unwrap().iter_mut().filter(|j| j.id == id) {
                j.cancel = true;
            }
            Ok(Value::Null)
        }

        "grid.read" => Ok(serde_json::to_value(grid::read_sheets(Path::new(s(args, "path")?), 5000)?)?),

        "backup.create" => backup::create(core, "manual"),
        "backup.list" => backup::list(core),
        "backup.restore" => backup::restore(core, s(args, "name")?),
        "backup.export" => backup::export_json(core),

        "handoff.prepare" => handoff::prepare(core, args),

        "voice.status" => Ok(voice::status(core)),
        "voice.install" => voice::install(core, s(args, "voice")?),
        "voice.remove" => voice::remove(core),
        "voice.speak" => voice::speak(core, s(args, "voice")?, s(args, "text")?),

        "app.info" => {
            let size = std::fs::metadata(&core.db_path).map(|m| m.len()).unwrap_or(0);
            Ok(json!({
                "version": env!("CARGO_PKG_VERSION"),
                "dataDir": core.data_dir.to_string_lossy(),
                "dbPath": core.db_path.to_string_lossy(),
                "dbSize": size,
                "sep": std::path::MAIN_SEPARATOR.to_string(),
            }))
        }
        other => Err(anyhow!("unknown command: {other}")),
    }
}
