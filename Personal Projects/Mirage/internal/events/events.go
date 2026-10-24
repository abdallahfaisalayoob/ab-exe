// Package events is Mirage's event log behind a swappable Store interface.
// SQLite (pure-Go) is the default; an in-memory store backs tests and the
// "memory" driver. Events are REDACTED by default: no full cookies, auth
// headers or bodies are stored unless privacy.store_raw is enabled.
package events

import (
	"sync"
	"time"
)

// Kind classifies an event.
type Kind string

const (
	KindScore     Kind = "score"      // a session was scored
	KindRung      Kind = "rung"       // a ladder rung fired
	KindShadow    Kind = "shadow"     // a session was shadowed
	KindTrip      Kind = "honeytoken" // a honeytoken tripped
	KindLeak      Kind = "leak"       // the leak filter redacted a response
	KindIngress   Kind = "ingress"    // an ingress violation
	KindManual    Kind = "manual"     // an operator allow/block
)

// Event is one recorded event. Fields are already redacted by the caller.
type Event struct {
	ID        int64
	At        time.Time
	Kind      Kind
	SessionID string
	IP        string
	FP        string
	Path      string
	Score     int
	Agent     int
	Hostile   int
	Rung      string
	Detail    string // short, redacted human detail
}

// Store persists and queries events.
type Store interface {
	Append(e Event) error
	Recent(limit int) ([]Event, error)
	ByKind(k Kind, limit int) ([]Event, error)
	Close() error
}

// Memory is an in-memory ring of events.
type Memory struct {
	mu   sync.Mutex
	ring []Event
	cap  int
	next int64
}

// NewMemory builds an in-memory store holding up to cap events.
func NewMemory(cap int) *Memory {
	if cap <= 0 {
		cap = 10000
	}
	return &Memory{cap: cap}
}

func (m *Memory) Append(e Event) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.next++
	e.ID = m.next
	if e.At.IsZero() {
		e.At = time.Now()
	}
	m.ring = append(m.ring, e)
	if len(m.ring) > m.cap {
		m.ring = m.ring[len(m.ring)-m.cap:]
	}
	return nil
}

func (m *Memory) Recent(limit int) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return tail(m.ring, limit), nil
}

func (m *Memory) ByKind(k Kind, limit int) ([]Event, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var out []Event
	for i := len(m.ring) - 1; i >= 0 && len(out) < limit; i-- {
		if m.ring[i].Kind == k {
			out = append(out, m.ring[i])
		}
	}
	return out, nil
}

func (m *Memory) Close() error { return nil }

func tail(xs []Event, limit int) []Event {
	if limit <= 0 || limit > len(xs) {
		limit = len(xs)
	}
	out := make([]Event, limit)
	// newest first
	for i := 0; i < limit; i++ {
		out[i] = xs[len(xs)-1-i]
	}
	return out
}
