# Personal Universe

A local-first operating environment for your digital life — files, university, money, projects
and time in one private Windows desktop application.

No accounts. No cloud. No API keys. No telemetry. Everything lives in one SQLite file on your PC.

```
┌──────────────────────────── Personal Universe (Tauri 2 window) ────────────────────────────┐
│  React + TypeScript interface  ──invoke("pu", {cmd,args})──▶  Rust core (pu-core)          │
│  7 worlds · command bar · drop zone                           SQLite + FTS5 · indexer      │
│                                ◀── pu://thumb, pu://file ───  extraction · backups         │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

## The seven worlds

| World | What it is |
|---|---|
| **Home** | Command centre. The *Day Arc* shows today's classes, study sessions and deadlines; rearrangeable instruments, saved as named workspaces (Everyday / Study / Money / your own). |
| **Knowledge** | Your files, indexed where they live. Five views of the same scope — **Map** (zoomable spatial view), **Gallery**, **Folders**, **Graph** (living knowledge map) and **Timeline** — plus full-text search, duplicates, tags, favourites, missing-file tracking and an **Inbox** review flow. |
| **Academy** | Excel timetable import with conflict detection, week/day/month calendars, deadlines, course workspaces, the **Workload planner** (what-if simulator) and an editable **prompt library** with AI handoff. |
| **Finance** | Accounts, assets, liabilities, transactions, transfers, budgets, savings goals, recurring payments, PKR/USD with a rate *you* set; net-worth timeline, income vs spending, category donut and heatmap, daily cash-flow, rule-based projection and runway. CSV/Excel statement import. |
| **Projects** | Workspaces with a drag board, milestone timeline, notes, linked files and course. |
| **Archive** | **Time machine** (scrub your history month by month), the road ahead, weekly/monthly review, backup & recovery, and the **privacy ledger**. |
| **Tools** | Offline engineering bench (Ohm's law, resistor colour codes, wavelength, dB/dBm, base conversion with two's complement, Boolean truth tables, RC/RL/LC formulas, unit conversion) and the capture inbox. |

**O.R.I.O.N.** (*Offline, Rather Intelligent, Organisational Navigator*) wakes with the app: a short boot
sequence, then a spoken briefing — classes ahead, what is due, money, and the one thing most worth doing
today — with a one-click focus timer. Speech uses a voice installed on your PC. Try `orion joke` or
`orion focus 45` in the command bar. Greeting frequency, voice and how it addresses you are in Settings.

Everywhere: **Ctrl K** command bar (search + structured commands such as `quiz ML friday 3pm`,
`spent 450 on lunch`, `find all pdfs containing normalisation`), universal drop zone, Signals
(rule-based insights with their reasoning), three themes, Windows notifications for deadlines.

## Install on Windows

**Option A — build it yourself (10 minutes, one time)**

1. Install [Node.js 20+](https://nodejs.org), [Rust](https://rustup.rs) (default MSVC toolchain) and the
   "Desktop development with C++" workload of Visual Studio Build Tools. WebView2 is already part of Windows 10/11.
2. In this folder:

```bash
npm install
```

```bash
npm run build
```

3. Run the installer produced at `target\release\bundle\nsis\Personal Universe_0.1.0_x64-setup.exe`.
   It adds a Start-menu entry and a desktop shortcut and installs per-user (no admin rights).

**Option B — let GitHub build it**: the workflow in `.github/workflows/personal-universe.yml`
builds the installer on a Windows runner and attaches it to the run as an artifact.

Your data is stored in `%APPDATA%\com.personaluniverse.desktop\` (database, backups, thumbnails,
prepared handoffs). Uninstalling does not delete it.

## Develop

```bash
npm run dev
```

Runs the real desktop app with hot reload. To work on the interface in a normal browser instead,
start the development bridge (the same Rust core behind a localhost port) and Vite:

```bash
npm run bridge
```

```bash
npm run dev:ui
```

### Tests

```bash
npm test
```

```bash
npm run test:core
```

* `npm test` — 37 unit tests: the ORION briefing, timetable parsing (list, day×time grid, room×time grid with one sheet per
  day, time×day grid), conflict detection, natural-language dates, command grammar, finance maths
  (balances, net worth, transfers, projection, statement import), workload model, engineering helpers.
* `npm run test:core` — Rust integration tests against a real database: recursive import, DOCX/XLSX/CSV
  extraction, full-text search, incremental re-indexing, duplicate detection, missing-file handling,
  inbox rules, simultaneous imports, persistence across restart, atomic batches, backup → restore
  (with safety snapshot), JSON export, handoff packaging and the preview allow-list.

## Architecture

```
crates/core/        pu-core — everything that touches disk. No Tauri dependency, fully testable.
  schema.sql        the whole data model (one file, commented)
  db.rs             SQLite (WAL), migrations, JSON-typed query/exec/batch
  indexer.rs        folder ingestion: walk → diff against index → parallel extraction → batched writes
  extract.rs        PDF / DOCX / PPTX / XLSX / text / code → text, key terms, excerpts, image sizes
  grid.rs           spreadsheets → string grids (merged cells propagated) for timetable & statement import
  backup.rs         VACUUM INTO snapshots, validated restore, JSON export
  handoff.rs        AI handoff packaging + privacy ledger
  serve.rs          previews & cached thumbnails for indexed files only
  bin/pu-dev.rs     development bridge (not shipped)
src-tauri/          the desktop shell: one command (`pu`), the `pu://` protocol, OS plugins
src/
  lib/              pure logic with tests: timetable, finance, workload, commands, dates, eng, insights
  ui/               design-system components, custom icon set, SVG charts
  shell/            command bar, drop zone, handoff, quick-create dialogs, settings, file inspector
  worlds/           Home, Knowledge (+ canvas views), Academy (+ planner), Finance, Projects, Archive, Tools
docs/DESIGN.md      the design system and visual direction
docs/PRODUCT.md     product thinking: the original ideas, how they were evaluated, what is next
```

Design decisions worth knowing:

* **One doorway.** The interface never touches the disk; it calls `dispatch(cmd, args)` in the core. The
  desktop shell and the dev bridge are two thin transports over the same function, so browser tests
  exercise the real indexer and database.
* **Originals are read-only.** The indexer opens files for reading only. Removing a collection deletes index
  rows, never files. Handoffs copy. Duplicates are shown, not deleted.
* **Incremental by default.** A file whose size and modified-time are unchanged is not read again. Indexing
  runs on a background thread, one job at a time, extraction in parallel, writes in batches.
* **Honest numbers.** Insights, projections and workload figures are fixed rules over your own data, and
  each one states its rule. Without a USD rate, foreign-currency accounts are excluded from totals rather
  than guessed.

## Privacy

Nothing is transmitted by the application unless you switch it on. There are two outward paths. The
optional weather line in ORION's briefing (off by default) sends your city's coordinates — nothing
else — to open-meteo.com. The other is an AI handoff: the app copies the
chosen files and prompt into a folder, puts the prompt on the clipboard and — after you click — opens
claude.ai or chatgpt.com in your browser. You paste and attach. Each handoff, and switching weather on, is recorded in
Archive → Privacy ledger. The UI never claims a file was uploaded.

## Known limits (v0.1)

* Scanned PDFs and images are indexed by name and metadata only (no OCR). Legacy `.doc`/`.ppt` are not
  text-extracted; `.docx`/`.pptx`/`.xlsx`/`.xls` are.
* Watched folders are re-checked at launch and every ten minutes, not by a live file-system watcher.
* "Related files" and the graph use shared key terms (term frequency), not semantic embeddings — see
  `docs/PRODUCT.md` for the planned optional local semantic search.
* PDF pages are previewed as extracted text; "Open" launches your normal PDF reader.
