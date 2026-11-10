use pu_core::{dispatch, Core};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;

fn tmp(name: &str) -> PathBuf {
    let d = std::env::temp_dir().join(format!("pu-test-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&d);
    std::fs::create_dir_all(&d).unwrap();
    d
}

fn wait(core: &Arc<Core>) -> Value {
    for _ in 0..600 {
        if !core.busy() {
            return dispatch(core, "jobs.status", &json!({})).unwrap();
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    panic!("indexer did not finish");
}

fn q(core: &Arc<Core>, sql: &str, params: Value) -> Vec<Value> {
    dispatch(core, "db.query", &json!({ "sql": sql, "params": params })).unwrap().as_array().unwrap().clone()
}

fn docx(path: &Path, text: &str) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    z.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
    write!(z, "<w:document><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p><w:p><w:r><w:t>Second &amp; last paragraph</w:t></w:r></w:p></w:body></w:document>").unwrap();
    z.finish().unwrap();
}

#[test]
fn import_search_incremental_duplicates_missing() {
    let lib = tmp("lib");
    let core = Core::open(&tmp("data")).unwrap();
    std::fs::create_dir_all(lib.join("ml/week1")).unwrap();
    std::fs::create_dir_all(lib.join("node_modules/junk")).unwrap();
    let body = "Gradient descent minimises the loss function. Gradient descent updates weights using the gradient of the loss. Backpropagation computes each gradient layer by layer for the network weights.";
    std::fs::write(lib.join("ml/week1/notes.md"), body).unwrap();
    std::fs::write(lib.join("ml/week1/copy of notes.md"), body).unwrap();
    std::fs::write(lib.join("ml/train.py"), "import numpy as np\n# normalisation of the database features\nprint('hello')\n").unwrap();
    std::fs::write(lib.join("node_modules/junk/x.js"), "ignored").unwrap();
    docx(&lib.join("report.docx"), "Database normalisation removes redundancy through third normal form");

    let r = dispatch(&core, "files.import", &json!({ "paths": [lib.to_string_lossy()] })).unwrap();
    assert_eq!(r["jobs"].as_array().unwrap().len(), 1);
    let jobs = wait(&core);
    assert_eq!(jobs[0]["state"], "done", "{jobs}");
    assert_eq!(jobs[0]["added"], 4, "node_modules must be skipped");

    // Full-text search reaches inside documents, including DOCX.
    let hits = q(&core, "SELECT f.name FROM files_fts JOIN files f ON f.id = files_fts.rowid WHERE files_fts MATCH ? ORDER BY rank", json!(["normalisation"]));
    let names: Vec<&str> = hits.iter().map(|h| h["name"].as_str().unwrap()).collect();
    assert!(names.contains(&"report.docx") && names.contains(&"train.py"), "{names:?}");
    let text = dispatch(&core, "files.text", &json!({ "id": q(&core, "SELECT id FROM files WHERE name = 'report.docx'", json!([]))[0]["id"] })).unwrap();
    assert!(text["text"].as_str().unwrap().contains("Second & last paragraph"));

    // Duplicate content is detected through identical fingerprints.
    let dups = q(&core, "SELECT hash, COUNT(*) n FROM files GROUP BY hash HAVING n > 1", json!([]));
    assert_eq!(dups.len(), 1);
    assert_eq!(dups[0]["n"], 2);

    // Topic terms were extracted locally.
    let terms = q(&core, "SELECT term FROM file_terms t JOIN files f ON f.id = t.file_id WHERE f.name = 'notes.md'", json!([]));
    assert!(terms.iter().any(|t| t["term"] == "gradient"), "{terms:?}");

    // Importing the same folder again does not create a second collection or reprocess files.
    dispatch(&core, "files.import", &json!({ "paths": [lib.to_string_lossy()] })).unwrap();
    let jobs = wait(&core);
    let last = jobs.as_array().unwrap().last().unwrap();
    assert_eq!(last["unchanged"], 4);
    assert_eq!(last["added"], 0);
    assert_eq!(q(&core, "SELECT id FROM collections", json!([])).len(), 1);

    // A nested folder is recognised as already imported.
    let r = dispatch(&core, "files.import", &json!({ "paths": [lib.join("ml").to_string_lossy()] })).unwrap();
    assert_eq!(r["jobs"].as_array().unwrap().len(), 0);
    assert!(r["notices"][0].as_str().unwrap().contains("already inside"));

    // Change one file, delete another: only the changed one is re-read; the deleted one is flagged, not dropped.
    std::thread::sleep(std::time::Duration::from_millis(30));
    std::fs::write(lib.join("ml/train.py"), "print('fourier transform spectrum analysis')\n").unwrap();
    std::fs::remove_file(lib.join("ml/week1/copy of notes.md")).unwrap();
    let cid = q(&core, "SELECT id FROM collections", json!([]))[0]["id"].clone();
    dispatch(&core, "files.rescan", &json!({ "collection": cid })).unwrap();
    let jobs = wait(&core);
    let last = jobs.as_array().unwrap().last().unwrap();
    assert_eq!(last["updated"], 1, "{last}");
    assert_eq!(last["missing"], 1);
    assert_eq!(q(&core, "SELECT id FROM files WHERE missing = 1", json!([])).len(), 1);
    assert_eq!(q(&core, "SELECT rowid FROM files_fts WHERE files_fts MATCH 'fourier'", json!([])).len(), 1);
    assert_eq!(q(&core, "SELECT rowid FROM files_fts WHERE files_fts MATCH 'numpy'", json!([])).len(), 0);
    // The source folder itself was never modified by the app.
    assert!(lib.join("report.docx").exists() && lib.join("ml/week1/notes.md").exists());

    // Inbox drops: new files arrive as 'new'; files already in the library are not stolen.
    let stray = tmp("stray").join("download.txt");
    std::fs::write(&stray, "a stray download about antennas and antennas").unwrap();
    dispatch(&core, "files.import", &json!({ "paths": [stray.to_string_lossy(), lib.join("report.docx").to_string_lossy()], "inbox": true })).unwrap();
    wait(&core);
    let inbox = q(&core, "SELECT name FROM files WHERE inbox_state = 'new'", json!([]));
    assert_eq!(inbox.len(), 1);
    assert_eq!(inbox[0]["name"], "download.txt");

    // Removing a collection clears its index but never the originals.
    dispatch(&core, "db.exec", &json!({ "sql": "DELETE FROM collections WHERE id = ?", "params": [cid] })).unwrap();
    assert_eq!(q(&core, "SELECT rowid FROM files_fts WHERE files_fts MATCH 'gradient'", json!([])).len(), 0);
    assert!(lib.join("ml/week1/notes.md").exists());
}

#[test]
fn spreadsheet_grid_with_merged_cells_and_times() {
    let dir = tmp("grid");
    let path = dir.join("tt.xlsx");
    let mut wb = rust_xlsxwriter::Workbook::new();
    let ws = wb.add_worksheet();
    ws.set_name("Monday").unwrap();
    ws.write_string(0, 0, "Room").unwrap();
    ws.write_string(0, 1, "08:30-09:50").unwrap();
    ws.write_string(0, 2, "10:00-11:20").unwrap();
    ws.write_string(1, 0, "C-301").unwrap();
    ws.merge_range(1, 1, 1, 2, "Machine Learning (BEE-6A)\nDr. Khan", &rust_xlsxwriter::Format::new()).unwrap();
    wb.save(&path).unwrap();
    let core = Core::open(&tmp("griddata")).unwrap();
    let sheets = dispatch(&core, "grid.read", &json!({ "path": path.to_string_lossy() })).unwrap();
    assert_eq!(sheets[0]["name"], "Monday");
    assert_eq!(sheets[0]["rows"][0][1], "08:30-09:50");
    assert_eq!(sheets[0]["rows"][1][2], "Machine Learning (BEE-6A)\nDr. Khan", "merged value is propagated");
    assert_eq!(sheets[0]["merges"][0], json!([1, 1, 1, 2]));

    let csv = dir.join("bank.csv");
    std::fs::write(&csv, "Date;Description;Amount\n2026-01-03;Groceries;-1500\n").unwrap();
    let sheets = dispatch(&core, "grid.read", &json!({ "path": csv.to_string_lossy() })).unwrap();
    assert_eq!(sheets[0]["rows"][1][2], "-1500");
}

#[test]
fn persistence_backup_restore_and_handoff() {
    let data = tmp("persist");
    {
        let core = Core::open(&data).unwrap();
        dispatch(&core, "db.batch", &json!({ "stmts": [
            { "sql": "INSERT INTO accounts(name, kind, currency, opening_balance, opened_on) VALUES('Wallet','cash','PKR',1000,'2026-01-01')" },
            { "sql": "INSERT INTO transactions(account_id, date, amount, category, created_at) VALUES(1,'2026-01-02',-250.5,'Food',0)" },
            { "sql": "INSERT INTO activity(ts, world, kind, title) VALUES(1,'finance','tx','seed')" }
        ]})).unwrap();
        // A failing batch must leave nothing behind.
        let bad = dispatch(&core, "db.batch", &json!({ "stmts": [
            { "sql": "INSERT INTO transactions(account_id, date, amount, created_at) VALUES(1,'2026-01-03',-1,0)" },
            { "sql": "INSERT INTO no_such_table VALUES(1)" }
        ]}));
        assert!(bad.is_err());
    }
    // Restart: data is still there.
    let core = Core::open(&data).unwrap();
    let bal = q(&core, "SELECT a.opening_balance + SUM(t.amount) AS b, COUNT(*) n FROM accounts a JOIN transactions t ON t.account_id = a.id", json!([]));
    assert_eq!(bal[0]["b"], 749.5);
    assert_eq!(bal[0]["n"], 1);

    let b = dispatch(&core, "backup.create", &json!({})).unwrap();
    dispatch(&core, "db.exec", &json!({ "sql": "DELETE FROM transactions" })).unwrap();
    assert_eq!(q(&core, "SELECT id FROM transactions", json!([])).len(), 0);
    let r = dispatch(&core, "backup.restore", &json!({ "name": b["name"] })).unwrap();
    assert!(r["safety"].as_str().unwrap().contains("before-restore"));
    assert_eq!(q(&core, "SELECT id FROM transactions", json!([])).len(), 1);
    assert!(dispatch(&core, "backup.restore", &json!({ "name": "../evil.db" })).is_err());
    let exp = dispatch(&core, "backup.export", &json!({})).unwrap();
    let parsed: Value = serde_json::from_slice(&std::fs::read(exp["path"].as_str().unwrap()).unwrap()).unwrap();
    assert_eq!(parsed["accounts"][0]["name"], "Wallet");

    // Handoff: copies, never moves; missing files are reported honestly; the ledger records it.
    let src = tmp("handoff-src");
    std::fs::write(src.join("problem.txt"), "Find the Thevenin equivalent of the circuit circuit circuit").unwrap();
    std::fs::write(src.join("gone.txt"), "temporary temporary").unwrap();
    dispatch(&core, "files.import", &json!({ "paths": [src.join("problem.txt").to_string_lossy(), src.join("gone.txt").to_string_lossy()] })).unwrap();
    wait(&core);
    std::fs::remove_file(src.join("gone.txt")).unwrap();
    let ids: Vec<Value> = q(&core, "SELECT id FROM files ORDER BY name", json!([])).iter().map(|r| r["id"].clone()).collect();
    let h = dispatch(&core, "handoff.prepare", &json!({ "prompt": "Explain from first principles.", "title": "Thevenin help", "target": "claude", "fileIds": ids, "includeText": true })).unwrap();
    let statuses: Vec<&str> = h["files"].as_array().unwrap().iter().map(|f| f["status"].as_str().unwrap()).collect();
    assert_eq!(statuses, vec!["missing", "copied"]);
    assert!(src.join("problem.txt").exists(), "original stays in place");
    assert_eq!(std::fs::read_to_string(h["promptPath"].as_str().unwrap()).unwrap(), "Explain from first principles.");
    assert!(std::fs::read_to_string(h["textPath"].as_str().unwrap()).unwrap().contains("Thevenin"));
    assert_eq!(q(&core, "SELECT target FROM outbound_log", json!([]))[0]["target"], "claude");

    // Previews are only served for indexed files.
    assert!(pu_core::serve::serve(&core, "file", "/etc/hostname").is_err());
    assert!(pu_core::serve::serve(&core, "file", &src.join("problem.txt").to_string_lossy()).is_ok());
}

#[test]
fn simultaneous_imports_all_complete() {
    let core = Core::open(&tmp("multi-data")).unwrap();
    let mut paths = Vec::new();
    for i in 0..5 {
        let d = tmp(&format!("multi-{i}"));
        for j in 0..40 {
            std::fs::write(d.join(format!("note-{j}.txt")), format!("folder {i} document {j} about circuits circuits and signals signals")).unwrap();
        }
        paths.push(d.to_string_lossy().into_owned());
    }
    dispatch(&core, "files.import", &json!({ "paths": paths })).unwrap();
    let jobs = wait(&core);
    for j in jobs.as_array().unwrap() {
        assert_eq!(j["state"], "done", "{j}");
        assert_eq!(j["added"], 40);
    }
    assert_eq!(q(&core, "SELECT COUNT(*) n FROM files", json!([]))[0]["n"], 200);
    // Writes from the interface keep working while indexing runs.
    dispatch(&core, "files.rescan", &json!({})).unwrap();
    dispatch(&core, "db.exec", &json!({ "sql": "INSERT INTO settings(key, value) VALUES('k', '1')" })).unwrap();
}

#[test]
fn text_recognition() {
    let fixture = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scan-notes.png");
    if !pu_core::ocr::available() {
        eprintln!("OCR engine not available on this machine — recognition test skipped");
        assert!(pu_core::ocr::image_text(&fixture).is_none(), "without an engine nothing is invented");
        return;
    }
    let text = pu_core::ocr::image_text(&fixture).expect("the fixture contains printed text");
    eprintln!("OCR read: {}", text.replace('\n', " | "));
    let low = text.to_lowercase();
    assert!(low.contains("nyquist") && low.contains("stability"), "{text}");

    // A scanned PDF has no text layer; its page image is read instead.
    let scanned = pu_core::ocr::pdf_text(&fixture.with_file_name("scanned.pdf")).expect("scanned PDF is readable");
    assert!(scanned.to_lowercase().contains("nyquist"), "{scanned}");

    // End to end: a screenshot becomes searchable by the words inside it.
    let lib = tmp("ocr-lib");
    std::fs::copy(&fixture, lib.join("IMG_2041.png")).unwrap();
    let core = Core::open(&tmp("ocr-data")).unwrap();
    dispatch(&core, "files.import", &json!({ "paths": [lib.to_string_lossy()] })).unwrap();
    wait(&core);
    let hits = q(&core, "SELECT f.name FROM files_fts JOIN files f ON f.id = files_fts.rowid WHERE files_fts MATCH 'nyquist'", json!([]));
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0]["name"], "IMG_2041.png");
}

#[test]
fn scanned_pdf_page_images_are_found() {
    let pdf = Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/scanned.pdf");
    let pages = pu_core::ocr::pdf_jpegs(&pdf);
    assert_eq!(pages.len(), 1, "one page image in the fixture");
    assert_eq!(&pages[0][..2], &[0xFF, 0xD8], "it is a JPEG");
}
