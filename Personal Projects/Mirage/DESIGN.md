# Mirage — Design

Mirage is a self-hosted reverse proxy that defends a web app or API against
automated and AI-agent attackers. It does this by **misdirection** rather than
blocking, and by **inspecting responses** so that leaks get caught on the way out.

It is defence in depth. It does not replace patching.

## Request path

```
client ──► [kill switch] ──► [allowlist] ──► [ingress guard] ──► [session tracker]
                                                                       │
                                                         [scorer: agent × hostile]
                                                                       │
                                     ┌─────────────── ladder decision ─┘
                                     ▼
     monitor ─ pow challenge ─ tarpit ─ shadow ─ block
        │                               │
        ▼                               ▼
     origin ──► [leak filter] ──► client     shadow engine (fake app + honeytokens)
```

Every stage runs inside `failopen.Guard`. A panic or error in any Mirage stage
logs the problem, increments `mirage_failopen_total`, and forwards the
original request to the origin unchanged. The kill switch (config flag, the
`MIRAGE_KILL=1` env var, or a dashboard toggle) turns every stage off, which
leaves Mirage as a plain reverse proxy.

## Packages (`internal/`)

| Package | Responsibility |
|---|---|
| `config` | YAML loading, defaults (monitor-only), validation |
| `proxy` | `httputil.ReverseProxy` wrapper, pipeline, fail-open, kill switch |
| `session` | Session identity (Mirage cookie → IP+fingerprint fallback), per-session ring buffer of request summaries |
| `fingerprint` | Header-order / UA / TLS (JA3-lite from ClientHello when TLS terminates at Mirage) consistency |
| `ingress` | Body/field/header/timing limits, rule hook interface (Coraza-compatible adapter point), KEV virtual-patch pack |
| `scorer` | Feature extraction → heuristic scores + logistic regression; always returns reasons |
| `ladder` | Maps (score, route) → rung; PoW challenge, tarpit writer |
| `shadow` | Route-shape learner, deterministic per-session fake generator, honeytoken placement |
| `honeytoken` | Token minting (inert by construction), store, trip detection, check API |
| `leak` | Streaming response inspector, redaction rules (cookie size, keys, traces, phpinfo, config dumps), decodes gzip/base64 |
| `events` | Event store interface; SQLite (pure-Go `modernc.org/sqlite`) implementation; in-memory for tests |
| `alert` | Webhook + syslog sinks |
| `metrics` | Prometheus text exposition (hand-rolled, no client lib), latency histogram |
| `dashboard` | Embedded Go templates + small JS, JSON API, allow/block actions |
| `allowlist` | IP/CIDR, paths, rDNS-verified crawlers, Web Bot Auth (RFC 9421) verification |

`cmd/mirage` is the proxy binary. `cmd/mirage-sim` is the traffic simulator.
`testbed/` holds the toy origin apps and the compose file for the isolated
test network.

## Session scoring

A session is keyed by a signed Mirage cookie (`__mirage_sid`, HMAC). Clients
that drop cookies are keyed by `IP + coarse fingerprint`. Each session keeps
its last N request summaries: method, path template, status, size, timestamp,
a hash of the payload shape, and the fingerprint.

The scorer produces two numbers, **agent** (how automated or LLM-like) and
**hostile** (how attack-like), each 0–100, and a combined
`score = agent*hostile/100` boosted by hard signals. The features:

- **cadence**: median inter-request gap and the share of gaps in the 1.5–20 s
  "think-time" band that follows a response (LLM tool-call loop)
- **regularity**: coefficient of variation of the gaps (scripts have very low CV)
- **breadth**: distinct path templates per minute, plus 404 ratio
- **error-seeking**: the share of requests that follow a 4xx/5xx and go to the same or a sibling route
- **mutation**: same route with a changed payload shape, right after an error or block
- **fingerprint inconsistency**: the UA claims a browser but headers/TLS say a library
- **bait**: the client requested a path or used a value that exists only in Mirage-planted content. This is a hard signal (+40 hostile, +30 agent)

Every feature that contributes emits a reason string. A verdict without
reasons is a bug, and tests assert this.

The logistic-regression weights are trained offline by `mirage-sim train` on
labelled simulator traffic, then written into `internal/scorer/weights.go`. The
model is a dot product over about 10 features, so it is explainable, and its
per-feature contributions double as the reasons.

## Response ladder

The rungs are `monitor < pow < tarpit < shadow < block`. Config gives
thresholds per rung and optional per-route overrides. The rung actually applied is
`min(rung for score, max rung enabled)`. In the defaults only `monitor` is
enabled. Shadow additionally requires `agent >= shadow.min_agent` **and**
`hostile >= shadow.min_hostile`, so a confused human who is merely "hostile-ish"
cannot be shadowed. Allowlisted sessions are always pinned to monitor.

## Shadow engine

- **Shape learning.** For each path template (with numeric/UUID segments
  normalised to `{id}`), Mirage records status, content type, header names,
  and for JSON a structural schema (keys and value kinds). An OpenAPI file can
  seed the same structure.
- **Generation.** Values come from a PRNG seeded with
  `HMAC(server_secret, session_id ‖ template ‖ id)`, so the same session and
  the same object ID always produce the same record. Kinds are preserved: an
  int stays an int, an email stays email-shaped, and so on.
- **Fidelity.** Shadow responses copy the real route's header set and order,
  plus the server/date style. Latency is matched by sampling from that route's
  observed latency distribution. HTML pages are produced by fetching the real
  page once (cached, unauthenticated) and swapping text nodes and attribute
  values that look like data.
- **Honeytokens.** Fake API keys, credentials, `.env`, config files and admin
  endpoints are minted per session and registered in the store. They are
  inert by construction: random values that use reserved prefixes (`mrg_`),
  RFC 2606 domains (`example.invalid`), and TEST-NET IP ranges. Mirage never
  produces a value valid for any real provider.
- **Trips.** Every inbound request is scanned (path, query, headers, body
  prefix) for registered tokens. A hit raises a critical alert that carries the
  originating session's fingerprint. `POST /_mirage/api/check` lets other
  systems report a token they saw.
- **Defensive prompt text** (off by default). This is static text that only
  reaches shadowed sessions, inside an HTML comment or a JSON field. It may
  only mislead, stall or waste the reader's time. The constant
  `shadow.HackBackBoundary` documents the line, and `ValidateDecoyText`
  refuses text that asks the reader to execute, fetch, exfiltrate, or touch
  the reader's own environment.

## Leak filter

The filter wraps the `ResponseWriter` and buffers bodies up to a cap
(default 2 MiB), then streams the rest with an overlap window. Headers are
always inspected. Built-in rules:

- `Set-Cookie` values over a size cap (default 4 KiB) or with non-printable bytes. This is the memory-disclosure shape
- PEM private keys and cloud/provider key shapes
- JWTs in bodies of routes that never returned one before (learned)
- stack traces (PHP, Python, Java, Go, Node, .NET)
- `phpinfo()` markers
- dotenv / config-dump blocks

Each rule can redact, replace, or drop the header. Bodies with
`Content-Encoding: gzip` are decoded, inspected, and re-encoded; base64 runs
longer than 40 characters are decoded and rescanned once.

## Storage and privacy

Events go through an `events.Store` interface, with SQLite by default. The log
redactor removes cookies, Authorization headers, bodies, and PII-shaped
strings unless `privacy.store_raw: true`.

## Performance budget

The target is under 2 ms added at p50. The hot path has no allocation-heavy
work beyond the session map lookup, an O(features) score update, and header
scanning. The leak filter skips bodies whose content type is not text-like
(images, video) apart from header checks. A benchmark test enforces the
budget.
