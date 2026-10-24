// Package ladder implements Mirage's graduated response:
//
//	monitor → proof-of-work → tarpit → shadow → block
//
// The rung is chosen from the session's combined score and clamped to the
// operator-configured maximum (default monitor: nothing fires). Each rung is a
// deliberate escalation in how much the client's time is wasted, with the
// shadow rung (deception) sitting just below an outright block — because a
// block is feedback an agent mutates around, while a believable fake is not.
package ladder

import (
	"fmt"
	"net/http"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Rung is one step on the response ladder.
type Rung int

const (
	RungMonitor Rung = iota
	RungPoW
	RungTarpit
	RungShadow
	RungBlock
)

func (r Rung) String() string {
	switch r {
	case RungMonitor:
		return "monitor"
	case RungPoW:
		return "pow"
	case RungTarpit:
		return "tarpit"
	case RungShadow:
		return "shadow"
	case RungBlock:
		return "block"
	}
	return "monitor"
}

// ParseRung maps a config string to a Rung.
func ParseRung(s string) Rung {
	switch s {
	case "pow":
		return RungPoW
	case "tarpit":
		return RungTarpit
	case "shadow":
		return RungShadow
	case "block":
		return RungBlock
	default:
		return RungMonitor
	}
}

// Decide picks the rung for a combined score, clamped to the configured max.
func Decide(score int, cfg config.Ladder) Rung {
	max := ParseRung(cfg.MaxRung)
	var r Rung
	switch {
	case score >= cfg.BlockMin:
		r = RungBlock
	case score >= cfg.ShadowMin:
		r = RungShadow
	case score >= cfg.TarpitMin:
		r = RungTarpit
	case score >= cfg.PoWThreshold:
		r = RungPoW
	default:
		r = RungMonitor
	}
	if r > max {
		r = max
	}
	return r
}

// ShadowHandler serves a per-session fake response. Provided by the shadow
// engine (M5); when nil, the ladder falls back to a tarpit so the shadow rung
// still wastes attacker time without leaking the real app.
type ShadowHandler func(w http.ResponseWriter, r *http.Request, s *session.Session) bool

// Ladder executes rung responses.
type Ladder struct {
	cfg    config.Ladder
	shadow ShadowHandler
	// exposeRung, when true, sets an X-Mirage-Rung header (debug/test only;
	// NEVER enable in production — it tips off attackers, especially shadow).
	exposeRung bool
}

// New builds a Ladder.
func New(cfg config.Ladder, shadow ShadowHandler, exposeRung bool) *Ladder {
	return &Ladder{cfg: cfg, shadow: shadow, exposeRung: exposeRung}
}

// Serve applies the rung. It returns true if it fully handled the response
// (the proxy must not forward to the origin), false to continue to the origin.
func (l *Ladder) Serve(rung Rung, w http.ResponseWriter, r *http.Request, s *session.Session) bool {
	if l.exposeRung {
		w.Header().Set("X-Mirage-Rung", rung.String())
	}
	switch rung {
	case RungMonitor:
		return false
	case RungPoW:
		return l.servePoW(w, r, s)
	case RungTarpit:
		l.serveTarpit(w, r)
		return true
	case RungShadow:
		if l.shadow != nil && l.shadow(w, r, s) {
			return true
		}
		// Fail safe: no shadow engine → tarpit (never leak the real app).
		l.serveTarpit(w, r)
		return true
	case RungBlock:
		l.serveBlock(w, r)
		return true
	}
	return false
}

// servePoW issues or verifies a proof-of-work challenge. A real browser solves
// it transparently via the embedded JS; a cheap bot pays CPU on every session.
func (l *Ladder) servePoW(w http.ResponseWriter, r *http.Request, s *session.Session) bool {
	if s != nil && time.Now().Before(s.PoWClearedUntil) {
		return false // already cleared; let the request proceed
	}
	// Verify a submitted solution.
	if sol := r.Header.Get("X-Mirage-PoW"); sol != "" {
		if VerifyPoW(l.challenge(s), sol, l.cfg.PoWDifficulty) {
			if s != nil {
				s.PoWClearedUntil = time.Now().Add(10 * time.Minute)
			}
			return false // cleared; proceed to origin this request
		}
	}
	// Issue a challenge.
	challenge := l.challenge(s)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("X-Mirage-Challenge", challenge)
	w.Header().Set("X-Mirage-Difficulty", fmt.Sprintf("%d", l.cfg.PoWDifficulty))
	w.WriteHeader(http.StatusTooManyRequests)
	_, _ = w.Write(powPage(challenge, l.cfg.PoWDifficulty))
	return true
}

func (l *Ladder) challenge(s *session.Session) string {
	if s == nil {
		return "anon"
	}
	// Tie the challenge to the session id so a solution can't be shared.
	return s.ID
}

// serveTarpit drips a fake response slowly to waste the client's time.
func (l *Ladder) serveTarpit(w http.ResponseWriter, r *http.Request) {
	flusher, _ := w.(http.Flusher)
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(http.StatusOK)
	delay := time.Duration(l.cfg.TarpitDelayMS) * time.Millisecond
	if delay <= 0 {
		delay = 120 * time.Millisecond
	}
	// Bounded total time: ~40 drips max so we never hold a goroutine forever.
	msg := []byte("<!doctype html><html><head><title>Loading…</title></head><body>\n")
	_, _ = w.Write(msg)
	if flusher != nil {
		flusher.Flush()
	}
	ctx := r.Context()
	for i := 0; i < 40; i++ {
		select {
		case <-ctx.Done():
			return
		case <-time.After(delay):
		}
		if _, err := w.Write([]byte("<!-- please wait -->\n")); err != nil {
			return
		}
		if flusher != nil {
			flusher.Flush()
		}
	}
	_, _ = w.Write([]byte("</body></html>"))
}

func (l *Ladder) serveBlock(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	_, _ = w.Write([]byte("forbidden\n"))
}
