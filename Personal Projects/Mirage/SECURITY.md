# Security policy

## Mirage is defence in depth. It does not replace patching.

Mirage raises the cost of automated and AI-agent attacks and buys you time when
a response-side leak or a fresh CVE appears. It is **not** a substitute for:

- patching your application and its dependencies,
- fixing the vulnerabilities behind any leak the filter catches,
- authentication, authorization, and input validation in your app,
- a CDN/WAF/edge for volumetric and transport-layer attacks.

Every signature, heuristic and virtual-patch rule in Mirage **will** eventually
be bypassed by an adaptive adversary. Treat Mirage as one layer, not the layer.

## Operational guidance

- **Set `server_secret`** (or `MIRAGE_SECRET`) in production. It seeds session
  cookies, the shadow PRNG, and honeytoken derivation. Without it, a random
  secret is generated per start and sessions won't survive a restart.
- **Protect the admin interface.** `admin_listen` serves the dashboard, the kill
  switch, allow/block actions, and the honeytoken check API. Bind it to
  localhost or a private network and put authentication in front of it. Mirage
  does not ship auth for it.
- **Start in `monitor` mode.** Confirm humans score low before enabling any
  enforcement rung.
- **Keep the kill switch reachable.** `POST /admin/kill?on=1`, `kill_switch:
  true`, or `MIRAGE_KILL=1` turns Mirage into a plain pass-through instantly.

## Honeytokens and decoy text

- Honeytokens are **inert by construction** (reserved prefixes, RFC 2606
  domains, non-conforming key shapes). They authenticate nowhere. Report a bug
  if you believe any minted token could be a valid credential anywhere.
- Defensive decoy text may **only mislead or stall** an attacker's agent. Any
  offensive intent (code execution, shells, downloads, exfiltration, touching
  the reader's machine) is rejected in code (`shadow.ValidateDecoyText`,
  enforcing `shadow.HackBackBoundary`). **There is no hack-back.**

## Reporting a vulnerability

This is a student / portfolio project. Please open a private security advisory
or contact the maintainer rather than filing a public issue for anything
exploitable. Include a minimal reproduction and the Mirage version/commit.

Particularly valuable reports:
- a honeytoken value that is valid anywhere real,
- a way to make Mirage fail *closed* (take the origin down),
- a human-traffic pattern that gets shadowed,
- a secret shape the leak filter misses.
