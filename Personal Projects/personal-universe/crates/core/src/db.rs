use anyhow::{anyhow, Context, Result};
use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection};
use serde_json::{json, Map, Value};
use std::path::Path;

const SCHEMA_V1: &str = include_str!("schema.sql");
pub const LATEST: i64 = 2;

/// v2 — study plans: one sitting made of several subjects, each with its own time and intent.
const SCHEMA_V2: &str = "
CREATE TABLE IF NOT EXISTS study_plans (
  id INTEGER PRIMARY KEY,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  rhythm TEXT NOT NULL DEFAULT '50-10',
  state TEXT NOT NULL DEFAULT 'planned',      -- planned | running | done | cancelled
  created_at INTEGER NOT NULL,
  started_at INTEGER,
  ended_at INTEGER,
  studied_min INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE study_sessions ADD COLUMN plan_id INTEGER REFERENCES study_plans(id) ON DELETE CASCADE;
ALTER TABLE study_sessions ADD COLUMN seq INTEGER NOT NULL DEFAULT 0;
ALTER TABLE study_sessions ADD COLUMN minutes INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS study_sessions_plan ON study_sessions(plan_id);
CREATE INDEX IF NOT EXISTS study_sessions_date ON study_sessions(date);
";

pub fn open(path: &Path) -> Result<Connection> {
    let conn = Connection::open(path).with_context(|| format!("opening database {}", path.display()))?;
    // The timeout must be in place before anything else: other connections may be writing.
    conn.busy_timeout(std::time::Duration::from_secs(30))?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    Ok(conn)
}

pub fn migrate(conn: &mut Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version < 1 {
        let tx = conn.transaction()?;
        tx.execute_batch(SCHEMA_V1)?;
        tx.pragma_update(None, "user_version", 1)?;
        tx.commit()?;
    }
    if version < 2 {
        let tx = conn.transaction()?;
        tx.execute_batch(SCHEMA_V2)?;
        tx.pragma_update(None, "user_version", 2)?;
        tx.commit()?;
    }
    Ok(())
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn to_sql(v: &Value) -> SqlValue {
    match v {
        Value::Null => SqlValue::Null,
        Value::Bool(b) => SqlValue::Integer(*b as i64),
        Value::Number(n) => n
            .as_i64()
            .map(SqlValue::Integer)
            .unwrap_or_else(|| SqlValue::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn params(v: Option<&Value>) -> Vec<SqlValue> {
    v.and_then(|p| p.as_array()).map(|a| a.iter().map(to_sql).collect()).unwrap_or_default()
}

pub fn query(conn: &Connection, sql: &str, p: Option<&Value>) -> Result<Value> {
    let mut stmt = conn.prepare_cached(sql).with_context(|| format!("preparing: {sql}"))?;
    let names: Vec<String> = stmt.column_names().into_iter().map(|s| s.to_string()).collect();
    let mut rows = stmt.query(params_from_iter(params(p)))?;
    let mut out = Vec::new();
    while let Some(row) = rows.next()? {
        let mut obj = Map::with_capacity(names.len());
        for (i, name) in names.iter().enumerate() {
            let v = match row.get_ref(i)? {
                ValueRef::Null => Value::Null,
                ValueRef::Integer(n) => json!(n),
                ValueRef::Real(f) => json!(f),
                ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).into_owned()),
                ValueRef::Blob(_) => Value::Null,
            };
            obj.insert(name.clone(), v);
        }
        out.push(Value::Object(obj));
    }
    Ok(Value::Array(out))
}

pub fn exec(conn: &Connection, sql: &str, p: Option<&Value>) -> Result<Value> {
    let mut stmt = conn.prepare_cached(sql).with_context(|| format!("preparing: {sql}"))?;
    let changes = stmt.execute(params_from_iter(params(p)))?;
    Ok(json!({ "changes": changes, "lastId": conn.last_insert_rowid() }))
}

/// Runs several statements atomically. Either all of them apply or none do.
pub fn batch(conn: &mut Connection, stmts: &Value) -> Result<Value> {
    let list = stmts.as_array().ok_or_else(|| anyhow!("batch expects an array of statements"))?;
    let tx = conn.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
    let mut results = Vec::with_capacity(list.len());
    for s in list {
        let sql = s.get("sql").and_then(|v| v.as_str()).ok_or_else(|| anyhow!("statement without sql"))?;
        results.push(exec(&tx, sql, s.get("params"))?);
    }
    tx.commit()?;
    Ok(Value::Array(results))
}

pub fn log_activity(conn: &Connection, world: &str, kind: &str, title: &str, detail: Option<&str>) {
    let _ = conn.execute(
        "INSERT INTO activity(ts, world, kind, title, detail) VALUES(?,?,?,?,?)",
        rusqlite::params![now_ms(), world, kind, title, detail],
    );
}
