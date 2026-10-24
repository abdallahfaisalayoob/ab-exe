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

Mirage is **defence in depth. It does not replace patching.** See
[SECURITY.md](SECURITY.md) and [THREAT_MODEL.md](THREAT_MODEL.md).

## Status

Built in milestones. Current: **M1 — proxy core** (transparent reverse proxy,
per-session tracking, fail-open, kill switch, config, Docker). See
[DESIGN.md](DESIGN.md) for the full architecture and [DECISIONS.md](DECISIONS.md)
for the running log of design calls.

## Safety posture (ships exactly like this)

- **Monitor-only on first install** — scores and logs everything, enforces nothing.
- **Fail open, always** — any error inside Mirage passes traffic through untouched.
- **Shadow, tarpit, proof-of-work and decoy text are off** until you enable them.
- **Secrets/PII redacted in logs** by default.
- **Allowlist honoured** — health checks, your IPs, verified crawlers, and
  Web-Bot-Auth-signed agents are never shadowed.
- **Honeytokens are inert** — never valid anywhere.

## Quickstart (bare binary)

```sh
go build -o mirage ./cmd/mirage
cp mirage.example.yaml mirage.yaml   # edit origin + server_secret
./mirage -config mirage.yaml
```

Mirage listens on `:8080` (proxy) and `127.0.0.1:9900` (admin: `/healthz`,
`/metrics`, kill switch). Point your app's traffic at `:8080`.

## Kill switch

```sh
curl -X POST 'http://127.0.0.1:9900/admin/kill?on=1'   # instant pass-through
curl -X POST 'http://127.0.0.1:9900/admin/kill?on=0'   # back on
```

Or set `MIRAGE_KILL=1` / `kill_switch: true`.

## License

MIT — see [LICENSE](LICENSE).
