//! Reads spreadsheets (xlsx / xls / ods / csv) into plain string grids.
//! The timetable and finance importers in the interface work from these grids,
//! so every parsing decision stays visible and correctable by the user.

use anyhow::{anyhow, Result};
use calamine::{open_workbook_auto, Data, Reader, Sheets};
use serde::Serialize;
use std::path::Path;

#[derive(Serialize)]
pub struct Sheet {
    pub name: String,
    pub rows: Vec<Vec<String>>,
    /// Merged regions as [row0, col0, row1, col1] (inclusive). Values are already
    /// propagated across each region in `rows`.
    pub merges: Vec<[u32; 4]>,
}

fn fmt_time(frac: f64) -> String {
    let mins = (frac.fract() * 1440.0).round() as i64 % 1440;
    format!("{:02}:{:02}", mins / 60, mins % 60)
}

fn fmt_date(serial: f64) -> String {
    let base = chrono::NaiveDate::from_ymd_opt(1899, 12, 30).unwrap();
    match base.checked_add_signed(chrono::Duration::days(serial.floor() as i64)) {
        Some(d) => d.format("%Y-%m-%d").to_string(),
        None => serial.to_string(),
    }
}

fn cell(d: &Data) -> String {
    match d {
        Data::Empty => String::new(),
        Data::String(s) => s.trim().to_string(),
        Data::Int(i) => i.to_string(),
        Data::Float(f) => {
            if f.fract() == 0.0 && f.abs() < 1e15 {
                (*f as i64).to_string()
            } else {
                f.to_string()
            }
        }
        Data::Bool(b) => b.to_string(),
        Data::DateTime(dt) => {
            let v = dt.as_f64();
            if v < 1.0 {
                fmt_time(v)
            } else if v.fract() < 1e-9 {
                fmt_date(v)
            } else {
                format!("{} {}", fmt_date(v), fmt_time(v))
            }
        }
        Data::DateTimeIso(s) | Data::DurationIso(s) => s.clone(),
        Data::Error(_) => String::new(),
    }
}

fn read_csv(path: &Path, max_rows: usize) -> Result<Vec<Sheet>> {
    let raw = std::fs::read(path)?;
    let text = String::from_utf8_lossy(&raw);
    let first = text.lines().next().unwrap_or("");
    let delim = [b',', b';', b'\t', b'|']
        .into_iter()
        .max_by_key(|d| first.bytes().filter(|b| b == d).count())
        .unwrap_or(b',');
    let mut rdr = csv::ReaderBuilder::new().has_headers(false).flexible(true).delimiter(delim).from_reader(text.as_bytes());
    let mut rows = Vec::new();
    for rec in rdr.records().take(max_rows) {
        let rec = rec?;
        rows.push(rec.iter().map(|c| c.trim().trim_start_matches('\u{feff}').to_string()).collect());
    }
    let name = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    Ok(vec![Sheet { name, rows, merges: vec![] }])
}

pub fn read_sheets(path: &Path, max_rows: usize) -> Result<Vec<Sheet>> {
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    if matches!(ext.as_str(), "csv" | "tsv" | "txt") {
        return read_csv(path, max_rows);
    }
    let mut wb = open_workbook_auto(path).map_err(|e| anyhow!("could not open spreadsheet: {e}"))?;
    let names = wb.sheet_names().to_vec();
    let mut out = Vec::new();
    for name in names {
        let Ok(range) = wb.worksheet_range(&name) else { continue };
        let Some((r0, c0)) = range.start() else {
            out.push(Sheet { name, rows: vec![], merges: vec![] });
            continue;
        };
        let (r0, c0) = (r0 as usize, c0 as usize);
        let width = c0 + range.width();
        let mut rows: Vec<Vec<String>> = vec![vec![String::new(); width]; r0.min(max_rows)];
        for row in range.rows().take(max_rows.saturating_sub(r0)) {
            let mut line = vec![String::new(); c0];
            line.extend(row.iter().map(cell));
            rows.push(line);
        }
        let mut merges = Vec::new();
        if let Sheets::Xlsx(x) = &mut wb {
            for dim in x.merge_cells_by_sheet_name(&name).unwrap_or_default() {
                let (a, b) = (dim.start, dim.end);
                merges.push([a.0, a.1, b.0, b.1]);
                let value = rows.get(a.0 as usize).and_then(|r| r.get(a.1 as usize)).cloned().unwrap_or_default();
                if value.is_empty() {
                    continue;
                }
                for r in a.0..=b.0 {
                    for c in a.1..=b.1 {
                        if let Some(slot) = rows.get_mut(r as usize).and_then(|row| row.get_mut(c as usize)) {
                            *slot = value.clone();
                        }
                    }
                }
            }
        }
        out.push(Sheet { name, rows, merges });
    }
    Ok(out)
}
