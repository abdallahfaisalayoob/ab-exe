# Mirage 🪞

> A self-hosted reverse proxy that defends web apps and APIs against automated
> and AI-agent attackers by **misdirection**, not blocking.

When a session looks like a hostile agent with high confidence, Mirage doesn't
return a 403 — a block is just feedback an agent mutates around. Instead it
quietly moves that session into a per-session **shadow** of your real app:
responses shaped like the real routes, filled with fake data and tracked
honeytokens. The attacker burns time and tokens, fills its context with junk,
and trips an alarm the moment it uses anything it "found." Mirage also inspects
**outgoing** responses so secrets can't leak through a zero-day before you've
patched.

**Mirage is defence in depth. It does not replace patching.** See
[SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md).

---

## Why this exists

Request inspection alone can't separate a novel exploit from normal traffic —
the October 2026 PHP2Shell episode showed attackers mutating payloads past
every rule while a memory-disclosure bug leaked worker memory through a normal-
looking `Set-Cookie`. Two ideas follow:

1. **A block page is feedback.** An agent that gets a 403 mutates and retries.
   A believable fake success corrupts that feedback loop instead.
2. **The response side matters.** Secrets leak *outbound*; Mirage inspects
   responses and redacts secret-shaped content before it leaves.

Nobody else combines per-session shadowing of a real app, agent-behaviour
scoring, honeytoken tripwires and response leak filtering in one self-hostable
proxy. That combination is the point.

---

## What's inside

| Layer | What it does |
|---|---|
| **Proxy core** | Transparent reverse proxy, per-session tracking, **fail-open**, global kill switch |
| **Ingress guard** | Body/field/header limits (stops the PHP2Shell oversized-field shape), CISA-KEV virtual-patch pack, CRS/Coraza hook |
| **Session scorer** | Scores each *session* on two axes — how **agent-like**, how **hostile** — 0–100 with human-readable reasons, always |
| **Response ladder** | `monitor → proof-of-work → tarpit → shadow → block`, per score threshold |
| **Shadow engine** | Per-session consistent fakes seeded with inert tracked honeytokens |
| **Leak filter** | Redacts oversized cookies, private keys, API keys, stack traces, phpinfo, config dumps — through gzip and base64 |
| **Control plane** | Live dashboard, webhook + syslog alerts, Prometheus `/metrics` |

Architecture: [DESIGN.md](DESIGN.md). Design-call log: [DECISIONS.md](DECISIONS.md).
Honest caveats: [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md).

---

## Safety posture (ships exactly like this)

- **Monitor-only on first install** — scores and logs everything, enforces nothing.
- **Fail open, always** — any error inside Mirage passes traffic through untouched.
- **Shadow, tarpit, proof-of-work and decoy text are OFF** until you enable them.
- **Secrets/PII redacted in logs** by default.
- **Allowlist honoured** — health checks, your IPs, verified crawlers, and
  Web-Bot-Auth-signed agents are never shadowed.
- **Honeytokens are inert** — never valid anywhere. No hack-back, ever (enforced
  in code: `shadow.HackBackBoundary`).

---

## Quickstart in ten minutes

### Option A — `docker compose`

```sh
git clone <this repo> && cd Mirage
docker compose up            # Mirage in front of the bundled toy app
```

- Proxied traffic: `http://localhost:8080`
- Dashboard + metrics: `http://localhost:9900` (`/`, `/metrics`, `/healthz`)

Point it at **your** app by editing `mirage.example.yaml` (or setting
`MIRAGE_ORIGIN`) and removing the bundled `app` service.

### Option B — bare binary

```sh
go build -o mirage ./cmd/mirage
cp mirage.example.yaml mirage.yaml      # set origin + server_secret
./mirage -config mirage.yaml
```

### Turning on defences

Mirage starts in `monitor` mode. Watch the dashboard for a day, confirm humans
score low, then step up deliberately in `mirage.yaml`:

```yaml
mode: enforce
ladder:   { enabled: true, max_rung: tarpit }   # then: shadow, then block
shadow:   { enabled: true }
leak:     { enabled: true }
```

Instant safety valve at any time:

```sh
curl -X POST 'http://127.0.0.1:9900/admin/kill?on=1'   # pure pass-through
```

---

## The test harness

An **isolated, internal-only** Docker network with toy vulnerable-*shaped* apps
(login, REST API with object IDs, admin panel, upload form, a simulated leak
endpoint) and a traffic simulator with three labelled profiles: ordinary
humans, dumb scanners, and LLM-agent-style attackers.

```sh
docker compose --profile sim up          # drive labelled traffic through Mirage
go run ./cmd/mirage-sim offline -n 500    # fast, deterministic scorer evaluation
```

The simulator produces the *shape* of attacks only — no working exploit code.
The authoritative detection/false-positive numbers come from `offline` (it
preserves true request timing):

```
profile  avg   p50  escalate%  shadow%
human     3.7    3   0.0        0.0      ← zero human false positives
scanner  97.0   97   100.0      100.0
agent    89.2  100   99.2        67.2
```

Full-pipeline added latency: **p50 ≈ 0.05 ms, p99 ≈ 0.25 ms** (target < 2 ms).

---

## Honeytoken check API

Other systems can report a token they've seen; if Mirage planted it, a critical
alert fires:

```sh
curl -X POST http://127.0.0.1:9900/_mirage/api/check \
  -d '{"token":"mrg_live_sk_...","source":"pastebin-dump"}'
```

---

## License

MIT — see [LICENSE](LICENSE). Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md).
