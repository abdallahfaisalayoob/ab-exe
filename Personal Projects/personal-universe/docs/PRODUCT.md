# Product thinking

## What is wrong with the way we keep things

A folder tree answers one question — *where did I put it?* — and makes you answer it at the moment you know
least: when the file arrives. Everything else you might ask (*what is this about, what is it for, when did
it matter, what else is like it?*) is left to memory. Meanwhile your timetable, deadlines, money and
projects live in separate apps that know nothing of each other or of your files.

Personal Universe makes three bets:

1. **Index, don't relocate.** Files stay where they are. Organisation is a layer of meaning on top —
   collections, tags, links, terms — that can be changed without moving a byte.
2. **One scope, many lenses.** The same set of files can be a map, a gallery, a tree, a graph or a timeline.
   Choosing a lens never loses your place.
3. **Everything can point at everything.** A single `links` table connects files, courses and projects, so
   a lecture PDF knows its course, the course knows its deadlines, and the planner knows your week.

## Original ideas — generated, scored, decided

Scored 1–5 for usefulness (U), novelty (N), feasibility offline (F) and cost in performance/hardware
(P, 5 = free). Built means it is in v0.1.

| # | Idea | U | N | F | P | Decision |
|---|---|---|---|---|---|---|
| 1 | **Day Arc** — today as a single shape on Home | 5 | 4 | 5 | 5 | **Built** |
| 2 | **What-if workload simulator** — drag a deadline, see every week change before committing | 5 | 5 | 5 | 5 | **Built** |
| 3 | **Universal links** — one relation table for file ↔ course ↔ project | 5 | 3 | 5 | 5 | **Built** |
| 4 | **Sentence commands** — `quiz ML friday 3pm`, `spent 450 on lunch` executed locally by grammar | 5 | 4 | 5 | 5 | **Built** |
| 5 | **Privacy ledger** — an append-only record of every moment data could leave the machine | 4 | 5 | 5 | 5 | **Built** |
| 6 | **Explained insights** — every signal ships with the rule that produced it | 4 | 4 | 5 | 5 | **Built** |
| 7 | **Inbox review flow** — one item at a time: preview, attach, tag, next | 4 | 3 | 5 | 5 | **Built** |
| 8 | **Suggested filing** — "link to Machine Learning, because it mentions …" with the evidence shown | 4 | 4 | 5 | 5 | **Built** |
| 9 | **Runway & real subscription cost** — months of spending covered; subscriptions per year | 4 | 3 | 5 | 5 | **Built** |
| 10 | **Time machine snapshot** — "your universe at the end of this month", rebuilt from stored dates | 4 | 4 | 5 | 5 | **Built** |
| 11 | **Named Home workspaces** — Study / Money / your own layouts | 4 | 2 | 5 | 5 | **Built** |
| 12 | **Honest handoff** — prompt + copies in a folder, a checklist that never claims an upload | 5 | 3 | 5 | 5 | **Built** |
| 13 | Local semantic search (small embedding model, ONNX) | 4 | 3 | 3 | 2 | Next — optional download, off by default |
| 14 | OCR for scans and screenshots (Windows.Media.Ocr) | 4 | 2 | 3 | 3 | Next |
| 15 | Focus context — pin a course and the whole app filters to it | 4 | 4 | 4 | 5 | Next |
| 16 | File version snapshots (hash history per path, diff for text) | 3 | 3 | 4 | 3 | Later — hash history first, no content copies |
| 17 | Live file-system watcher instead of periodic rescan | 3 | 1 | 4 | 4 | Later |
| 18 | Global hotkey capture window (outside the app) | 3 | 2 | 4 | 5 | Later |
| 19 | 3D "walkable" library | 1 | 4 | 3 | 1 | Rejected — novelty without discovery value (see DESIGN.md) |
| 20 | Automatic transaction posting for recurring items | 2 | 1 | 5 | 5 | Rejected — a ledger must never fill itself in |

## Assumptions I challenged

* **"Use Three.js / 3D."** Position must carry meaning or it is decoration. The map and the graph are
  spatial; they are 2D so text stays legible and the app stays light on a student laptop.
* **"Semantic understanding of documents."** Without a model, the honest version is *shared key terms*.
  The interface says exactly that ("Related by shared terms", "because it mentions …") rather than
  implying comprehension.
* **"Productivity analytics."** There is no score, streak or percentage-of-day. Review shows what was
  finished and what is next, and says plainly that an empty week is not a verdict.
* **"Currency conversion."** No silent default rate. Until you enter one, other-currency accounts are
  left out of totals and the screen tells you so.

## Roadmap

1. Optional local semantic search and OCR (both strictly opt-in downloads).
2. Focus context and per-course dashboards on Home.
3. Live watcher; hash history for the time machine ("this file changed 6 times since September").
4. Encrypted database option (SQLCipher) with a passphrase.
5. Import/export of prompt collections; ICS export of the timetable.
