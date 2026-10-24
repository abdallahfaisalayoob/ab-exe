# Threat model

What Mirage is designed to defend against, and — just as important — what it is
**not**.

## Who Mirage is for

A small or self-hosted operator running a web app or API who can't afford
enterprise bot management, and whose origin traffic may bypass a CDN entirely.
Mirage is a single Go binary placed in front of the origin.

## Assets being protected

- **Origin availability** — Mirage must never take the site down (fail-open).
- **Secrets that shouldn't leave** — keys, private keys, config, stack traces,
  session memory accidentally emitted in responses.
- **Operator time and attacker cost asymmetry** — making automated attacks slow,
  expensive, and loud rather than cheap and quiet.

## Adversaries Mirage addresses

1. **Dumb scripted scanners / credential stuffers.** High-rate, metronomic,
   broad enumeration, high 404s. Scored and escalated reliably (100% in the
   simulator).
2. **LLM-agent-style attackers.** Think-time pauses, systematic enumeration,
   payload mutation after errors/blocks, and — decisively — acting on content
   only a reader would notice (semantic bait). Shadowed when confident; the
   shadow wastes their budget, poisons their context, and trips honeytokens.
3. **Zero-day / memory-disclosure response leaks.** Caught on the *response*
   side by the leak filter (oversized/binary cookies, keys, traces, phpinfo,
   config dumps) regardless of how normal the request looked.
4. **Known-CVE mass exploitation (shape).** The ingress guard + CISA-KEV
   virtual-patch pack blunt the obvious exploit shape as a cheap first pass
   while you patch.

## Adversaries Mirage does NOT stop

- **A determined, adaptive human attacker.** Signature and heuristic layers are
  bypassable by someone who studies them; Mirage raises cost, it doesn't make
  you unhackable.
- **Attacks that look exactly like one legitimate user.** Low-and-slow,
  single-request, perfectly human-shaped abuse scores low by design (that's how
  false positives stay near zero).
- **Vulnerabilities in your actual app.** Mirage is defence in depth in front of
  the origin. **It does not replace patching** (see SECURITY.md).
- **Network/transport attacks** (DDoS volumetrics, TLS downgrade, BGP, etc.).
  Out of scope; use a CDN/WAF/edge for those.
- **Compromise of the origin itself**, or of Mirage's host.

## Trust boundaries

- Clients are untrusted. Sessions are tracked by signed cookie with an
  IP+fingerprint fallback so a client can't cheaply reset its score.
- The origin is trusted for availability but **not** trusted to never leak — the
  leak filter inspects its responses.
- The admin/dashboard/metrics interface is sensitive (it can toggle the kill
  switch and allow/block sessions). Bind it to localhost or a private interface
  and put real auth in front of it. Mirage does not ship auth for it.
- Honeytokens are inert by construction and safe to serve; they authenticate
  nowhere.

## Key design properties

- **Fail-open is structural**, not a promise: every stage runs inside a guard;
  a panic or error degrades to plain proxying.
- **Scoring is per-session and explainable**: no verdict without reasons.
- **The shadow is per-session consistent**: the same fake id returns the same
  record, so an agent can't detect the fake by replay.
- **No hack-back**: defensive decoy text may only mislead or stall; offensive
  intent is rejected in code (`shadow.ValidateDecoyText`).

## Residual risk

See [KNOWN_LIMITATIONS.md](KNOWN_LIMITATIONS.md) for evasion paths, false-positive
risks, and privacy caveats, written honestly rather than as a sales pitch.
