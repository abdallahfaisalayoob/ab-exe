# Decisions

Running log of judgement calls made while building Mirage, so the reasoning is
auditable and I don't re-litigate settled choices.

## D1 — Language/runtime: Go, single static binary
Brief mandates Go. Using `CGO_ENABLED=0` everywhere so the binary is fully
static and the Docker image can be `scratch`/`distroless`.

## D2 — SQLite driver: `modernc.org/sqlite` (pure Go)
`mattn/go-sqlite3` needs cgo, which breaks the static-binary goal. The pure-Go
driver is slower but events are off the hot path (async writer). Behind an
`events.Store` interface so Postgres swaps in later.

## D3 — No Prometheus client library
Hand-roll the text exposition format. It's ~100 lines, keeps dependencies tiny,
and the metrics we need (counters + one latency histogram) are trivial. Avoids
pulling a large dependency tree into a security product.

## D4 — Scorer: heuristics first, then logistic regression
Brief says keep it small and explainable. A logistic regression over ~10
features is a dot product; its per-feature contributions ARE the human-readable
reasons. No model stored as an opaque blob — weights are generated into a Go
source file (`internal/scorer/weights.go`) by `mirage-sim train`. Heuristics
remain as hard-signal overrides (e.g. honeytoken bait is deterministic, not
probabilistic).

## D5 — Session identity
Primary key is a signed cookie `__mirage_sid` (HMAC with server secret).
Cookie-dropping clients fall back to `IP + coarse fingerprint`. This means a
client cannot cheaply reset its score by clearing a cookie — the fallback still
tracks it. Documented as a privacy consideration.

## D6 — Fail-open is structural, not a code-review promise
A single `failopen.Guard(name, fn)` wraps every stage. Any panic or error →
log + metric + pass original request through untouched. The pipeline is a slice
of guarded stages; removing/erroring a stage degrades to plain proxying. Kill
switch short-circuits the whole pipeline.

## D7 — Shadow consistency via seeded PRNG
Fake data must be identical for the same (session, route, id) across requests or
an agent notices. Seed = HMAC(server_secret, session_id ‖ template ‖ id). No
state to store per fake record; it regenerates deterministically. Value *kinds*
are preserved from the learned schema (int stays int, email stays email-shaped).

## D8 — Honeytokens inert by construction
Never mint a value that could authenticate anywhere. Fake keys use the reserved
prefix `mrg_`, fake domains use RFC 2606 `.invalid`/`example.com`, fake IPs use
TEST-NET-1 `192.0.2.0/24`. A unit test asserts no minted token matches common
real provider key regexes.

## D9 — Defensive prompt injection: hard ethical boundary in code
`shadow.HackBackBoundary` is a documented constant. `ValidateDecoyText` rejects
any decoy text containing execute/shell/download/exfiltrate/reverse-connection
intent. The feature is off by default and can only *mislead or stall* a reader.
No hack-back, ever. This is enforced, not just documented.

## D10 — Leak filter buffering
Buffer response bodies up to 2 MiB for full inspection; beyond that, stream with
a sliding overlap window so a secret split across chunk boundaries is still
caught. Non-text content types skip body scanning (headers always scanned) to
protect the latency budget.

## D11 — Test network isolation
All toy vulnerable apps and the simulator run on an internal-only Docker network
(`internal: true`) with no route to the internet. No real exploit code is
written — only the *shape* of attacks (oversized fields, memory-leak-shaped
responses) is simulated.

## D12 — Repository placement
Mirage lives under `ab-exe/Personal Projects/Mirage` to fit the existing repo
layout, with its own self-contained Go module and MIT licence.
