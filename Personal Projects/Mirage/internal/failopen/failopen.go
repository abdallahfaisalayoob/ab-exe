// Package failopen makes "Mirage must never take the site down" a structural
// guarantee rather than a promise. Every Mirage stage runs inside Guard: if it
// panics or returns an error, the failure is recorded and the caller proceeds
// as if the stage had done nothing.
package failopen

import (
	"log/slog"
	"runtime/debug"
	"sync/atomic"
)

// failures counts fail-open events for the metrics endpoint.
var failures atomic.Int64

// Failures returns the total number of fail-open events since start.
func Failures() int64 { return failures.Load() }

// Guard runs fn, converting any panic into a recorded fail-open event. It
// returns true if fn ran cleanly, false if it panicked (in which case the
// caller must fall back to pass-through behaviour).
func Guard(stage string, fn func()) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			failures.Add(1)
			slog.Error("mirage stage failed open",
				"stage", stage, "panic", r, "stack", string(debug.Stack()))
			ok = false
		}
	}()
	fn()
	return true
}

// GuardErr is like Guard but for stages that signal failure via error. A
// non-nil error or a panic both count as a fail-open event.
func GuardErr(stage string, fn func() error) (ok bool) {
	defer func() {
		if r := recover(); r != nil {
			failures.Add(1)
			slog.Error("mirage stage failed open",
				"stage", stage, "panic", r, "stack", string(debug.Stack()))
			ok = false
		}
	}()
	if err := fn(); err != nil {
		failures.Add(1)
		slog.Warn("mirage stage error, failing open", "stage", stage, "err", err)
		return false
	}
	return true
}
