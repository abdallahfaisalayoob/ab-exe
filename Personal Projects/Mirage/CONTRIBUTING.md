# Contributing to Mirage

Thanks for your interest! Mirage is a self-hosted deception proxy; the value is
the deception architecture, so contributions that make the fakes more
convincing, the scoring more explainable, or the leak filter more thorough are
especially welcome.

## Ground rules

- **Fail-open is sacred.** No change may make Mirage able to take the origin
  down. Every new stage runs inside `failopen.Guard`.
- **No verdict without reasons.** The scorer must always explain itself.
- **No hack-back, ever.** Decoy text may only mislead or stall. Offensive intent
  is rejected by `shadow.ValidateDecoyText`; don't weaken that boundary.
- **Honeytokens stay inert.** Never introduce a token shape that could be a
  valid credential anywhere. Add a case to the inertness test if you add a kind.
- **No working exploit code**, even in the test harness — simulate the *shape*
  of attacks only, on the internal-only network.

## Development

```sh
go build ./...
go test ./...
go vet ./...
go run ./cmd/mirage-sim offline -n 500   # scorer evaluation (0% human FP gate)
```

Requirements: Go 1.24+. No cgo — keep the binary static (the SQLite driver is
pure Go for this reason).

## Project layout

```
cmd/mirage        the proxy binary
cmd/mirage-sim    traffic simulator (offline | run | train)
internal/         one package per layer (see DESIGN.md)
testbed/          toy apps + Dockerfiles for the isolated harness
```

## Pull requests

- Add tests. The scorer change set must keep human false positives at zero in
  `mirage-sim offline` and stay under the latency budget.
- Keep commits focused; explain *why* in the message, not just *what*.
- Update `DESIGN.md` / `DECISIONS.md` when you make an architectural call, and
  `KNOWN_LIMITATIONS.md` if you discover (or close) an evasion path.
- Run `go vet` and `gofmt`.

## Code style

Match the surrounding code: small packages, documented exported symbols,
table-driven tests. Comments explain intent and trade-offs, not mechanics.

By contributing you agree your contributions are licensed under the MIT License.
