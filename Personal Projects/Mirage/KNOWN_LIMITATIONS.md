# Known limitations

Written honestly, not as a sales pitch. Mirage raises the cost of automated and
AI-agent attacks; it does not make you unhackable, and several of its layers are
bypassable by a patient, adaptive adversary. If you only read one line: **Mirage
is defence in depth and does not replace patching.**

This document is the output of deliberately trying to break Mirage (the final
milestone). Each item says what we tried, what we fixed, and what residual risk
remains.

## 1. Can an agent tell it's in the shadow and leave?

**Fixed / mitigated:**
- **Replay consistency.** The same (session, route, id) returns byte-identical
  fakes, so probing the same object twice doesn't reveal the fake. (Tested.)
- **Reserved-TLD tell.** Ordinary fake data (emails, URLs) now uses realistic
  domains; only honeytokens use reserved/inert values. (Tested.)
- **Zero-latency tell.** Shadow responses add a seeded ~25–160ms delay so they
  don't return in suspiciously uniform near-zero time. (Tested.)
- **Structural fidelity.** Fakes are generated from the learned JSON schema, so
  status, keys, and value kinds match a real response.

**Residual risk (real):**
- **Latency matching is approximate.** The jitter is a plausible band, not a
  learned per-route distribution. An agent that measured the real route's
  latency *before* being shadowed could notice a change.
- **Header fidelity is partial.** Mirage mirrors content type and a couple of
  learned header names, but can miss the exact `Server`, cookie attributes,
  ordering, or vendor headers the real app sends. An agent that captured a real
  response during recon can diff headers.
- **Cross-field semantic consistency.** Values are individually plausible but
  not jointly reasoned (e.g. a `country` field won't agree with a `phone`
  country code). A sophisticated agent checking internal consistency can find
  seams.
- **HTML shadowing is light-touch.** It swaps data-looking substrings in a
  cached real page rather than rewriting a DOM; complex apps may show stale or
  mismatched fragments.
- **State transitions.** A fake `POST` that "succeeds" won't be reflected by a
  later `GET` unless both hit the generator the same way; multi-step workflows
  are where fakes are most detectable.

An agent that detects the shadow and leaves has still burned time and budget and
revealed itself — but it gets out. This is the hardest problem in the product
and is not fully solved.

## 2. Can a normal human get mis-scored and shadowed?

**Measured:** across 400+ simulated human sessions and a full live run, **zero**
reached the shadow threshold; the combined score multiplies the agent and
hostile axes, so a fast-but-benign human stays low. Allowlisted clients are
never shadowed.

**Residual risk:**
- **Shared egress IPs.** The cookie-dropping fallback keys on `IP + coarse
  fingerprint`. A human behind the same corporate NAT/VPN as an attacker, both
  with cookies disabled, could share a fallback identity. Cookie-bearing clients
  are unaffected.
- **Power users with CLI tools.** A human driving the API with `curl`/scripts at
  machine cadence and enumerating broadly can look agent-like *and* hostile. Use
  the allowlist for known internal tooling.
- **Thresholds are operator-set.** Lowering `shadow_threshold` or the
  `min_agent`/`min_hostile` gates trades false positives for coverage. The
  defaults are deliberately conservative.
- **The simulator is a model, not reality.** Real human traffic is more varied;
  validate in `monitor` mode against your own traffic before enforcing.

## 3. What does fail-open leave exposed?

Fail-open is a deliberate choice: **availability over protection.** The
consequences are honest ones:
- If a Mirage stage panics or errors, that request proceeds to the origin
  **unprotected** (no scoring, no shadow, no leak filtering for that request).
  The origin stays up; the protection is what's lost.
- The **kill switch** and `monitor` mode are full/partial bypasses by design.
- The **leak filter fails open too**: if it errors, a response it would have
  redacted can pass through. We chose not to risk blocking legitimate responses.
  This means the leak filter is a safety net, not a guarantee.
- Anyone who can reach the **admin interface** can flip the kill switch or
  allow/block sessions. Mirage ships no auth for it — bind it privately and put
  auth in front (see SECURITY.md).

## 4. Does the leak filter miss encoded or compressed secrets?

**Fixed / mitigated:** gzip and deflate/zlib bodies are decoded, redacted and
re-encoded; one layer of long base64 runs is decoded and rescanned; oversized/
binary cookies and the common key/trace/phpinfo/config shapes are covered.

**Residual risk (real):**
- **Brotli/zstd and other encodings can't be inspected.** They are flagged
  (`unscannable_encoding:…`) and passed through — a secret inside a brotli
  response will leak. This is surfaced, not hidden.
- **Nested/alternate encodings.** Double-base64, hex-encoded, URL-encoded, or
  split-then-reassembled secrets are not chased recursively (one base64 pass
  only).
- **Streaming boundary.** Beyond the 2 MiB full-buffer cap, inspection streams
  with a 256-byte overlap; a secret deliberately split across chunks wider than
  that window could evade.
- **Non-text content types skip body scanning** (headers still scanned) to hold
  the latency budget — a secret embedded in an image/binary body isn't caught.
- **Pattern-based.** Novel secret formats not matching a rule pass; add
  `extra_patterns`. Regexes can also over-redact (false positives) on content
  that merely looks key-shaped.

## 5. Could the defensive prompt injection backfire, leak, or confuse a legit client?

The feature is **off by default** and, when on, is only emitted to **shadowed**
(high-confidence hostile) sessions, inside HTML comments or non-rendered JSON
fields a human never sees.

**Enforced:** `shadow.ValidateDecoyText` rejects any offensive intent (code
execution, shells, downloads, exfiltration, touching the reader's machine),
enforcing `shadow.HackBackBoundary`. **There is no hack-back**, under any
configuration.

**Residual risk:**
- **A mis-scored legitimate agent would see it.** If a benign automated client
  is (wrongly) shadowed, it could read and act on the misleading text — e.g. a
  customer's own AI assistant being told "this is staging, credentials revoked."
  Allowlist known-good agents (Web Bot Auth / verified crawlers) — now
  implemented (see below).

### Allowlist scope (implemented)

The allowlist (IP/CIDR, health-check paths, reverse-DNS-verified crawlers with
forward confirmation, and RFC 9421 Ed25519 Web Bot Auth signatures) is wired in
and pins matching clients to the monitor rung, so they are never challenged,
tarpitted or shadowed. Residual gaps, stated honestly:
- **Web Bot Auth verifies against operator-configured keys only.** It does not
  yet fetch a live key *directory*, nor enforce `created`/`expires` freshness
  windows or a nonce/replay cache — a captured signature could be replayed until
  the covered components change. It covers Ed25519 only.
- **Crawler verification trusts DNS.** It is as strong as the resolver;
  forward-confirmation defeats forged PTRs, but a resolver compromise defeats it.
  Results are cached for 15 minutes, so a revoked crawler IP stays trusted until
  the entry expires.
- **Allowlisting is all-or-nothing per request** (monitor rung); there is no
  per-route or partial exemption.
- **Decoy text can be fingerprinted.** Once the static default text is known,
  an attacker can detect Mirage by it. It's a stall, not a secret.
- **Caching/propagation.** If a shadow response is cached or shared, the decoy
  travels with it. Don't enable it where responses may be cached downstream.

## Other honest caveats

- **Signature layers (ingress guard, virtual-patch pack, scorer heuristics) will
  be bypassed** by an adversary who studies them. They are a cheap first pass
  while you patch, not a wall.
- **The scorer needs a few requests** to build a session window; the first
  requests of a hostile session may pass before it's confident.
- **No clustering across sessions.** An attacker rotating IPs/cookies/fingerprints
  resets to a fresh low score each time. Mirage scores per session, not per
  actor.
- **Privacy.** By default Mirage stores redacted events only (no full cookies,
  auth headers or bodies). The IP+fingerprint fallback identity is itself
  personal data; the event store and dashboard should be access-controlled and
  retention-limited per your jurisdiction.
- **Legal/ethical boundary.** Honeytokens are inert and authenticate nowhere;
  Mirage never touches an attacker's machine. Deception is confined to responses
  Mirage itself serves.

## Reproducing the red-team

```sh
# shadow detectability probes (redteam_test.go)
go test ./internal/shadow/ -run 'Shadow(FakeData|AddsLatency|ReplayStable)' -v
# encoding/leak evasion probes (redteam_test.go)
go test ./internal/leak/ -run 'Deflate|UnknownEncoding|Base64|Gzip' -v
# human-FP / detection gate
go run ./cmd/mirage-sim offline -n 500
```
