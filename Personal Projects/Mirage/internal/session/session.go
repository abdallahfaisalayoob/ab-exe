// Package session tracks per-session identity and a rolling window of request
// summaries. A session is the unit the scorer reasons over — not a single
// request — because agent behaviour is only visible across requests.
package session

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/fingerprint"
)

// CookieName is the Mirage session cookie.
const CookieName = "__mirage_sid"

// ReqSummary is a compact record of one request/response, kept in the window.
type ReqSummary struct {
	At          time.Time
	Method      string
	Template    string // path with numeric/uuid segments normalised to {id}
	RawPath     string
	Status      int
	ReqBytes    int64
	RespBytes   int64
	PayloadHash string // hash of the request's payload *shape* (keys/kinds)
	Baited      bool   // request touched a Mirage-planted path/value
	AfterError  bool   // the previous response in this session was 4xx/5xx
}

// Session holds identity and the rolling request window for one client.
type Session struct {
	ID       string
	IP       string
	FP       fingerprint.Print
	Created  time.Time
	LastSeen time.Time

	mu     sync.Mutex
	window []ReqSummary
	cap    int

	// Rung is the last ladder rung applied (set by the ladder stage).
	Rung string
	// Score/Agent/Hostile cache the last scoring result for the dashboard.
	Score, Agent, Hostile int
	Reasons               []string
	// ManualVerdict is "", "allow", or "block" (set from the dashboard).
	ManualVerdict string

	// PoWClearedUntil is when a solved proof-of-work challenge expires. While
	// in the future, the session skips the PoW rung.
	PoWClearedUntil time.Time
	// ShadowSeed is the per-session seed for deterministic fake generation. It
	// is set once the first time the session is shadowed.
	ShadowSeed string
}

// New builds a bare session with the given id and window capacity. Used by the
// traffic simulator and tests to construct sessions outside the HTTP path.
func New(id string, windowCap int) *Session {
	if windowCap <= 0 {
		windowCap = 64
	}
	now := time.Now()
	return &Session{ID: id, Created: now, LastSeen: now, cap: windowCap, Rung: "monitor"}
}

// SetFP sets the fingerprint (used by the simulator/tests).
func (s *Session) SetFP(fp fingerprint.Print) { s.FP = fp }

// Add appends a summary, evicting the oldest when the window is full.
func (s *Session) Add(rs ReqSummary) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.window) > 0 {
		prev := s.window[len(s.window)-1]
		rs.AfterError = prev.Status >= 400
	}
	s.window = append(s.window, rs)
	if len(s.window) > s.cap {
		s.window = s.window[len(s.window)-s.cap:]
	}
	s.LastSeen = rs.At
}

// Window returns a copy of the current request window.
func (s *Session) Window() []ReqSummary {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]ReqSummary, len(s.window))
	copy(out, s.window)
	return out
}

// Len returns the number of requests in the window.
func (s *Session) Len() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.window)
}

// Store is a concurrent in-memory map of sessions with periodic eviction.
type Store struct {
	secret  []byte
	cap     int
	ttl     time.Duration
	mu      sync.RWMutex
	byID    map[string]*Session
	lastGC  time.Time
}

// NewStore builds a session store. windowCap is requests retained per session;
// secret signs the session cookie. An empty secret generates a random one.
func NewStore(secret string, windowCap int) *Store {
	b := []byte(secret)
	if len(b) == 0 {
		b = make([]byte, 32)
		_, _ = rand.Read(b)
	}
	if windowCap <= 0 {
		windowCap = 64
	}
	return &Store{
		secret: b,
		cap:    windowCap,
		ttl:    30 * time.Minute,
		byID:   make(map[string]*Session),
		lastGC: time.Now(),
	}
}

// Secret returns the store's signing secret (used to seed the shadow engine's
// deterministic generator when no explicit server_secret is configured).
func (s *Store) Secret() []byte { return s.secret }

// Identify resolves (or creates) the session for a request and returns it plus
// the cookie value that should be set on the response (empty if already set).
func (s *Store) Identify(r *http.Request, tlsHint string) (*Session, string) {
	ip := clientIP(r)
	fp := fingerprint.From(r, tlsHint)

	// Primary identity: a valid signed cookie.
	if c, err := r.Cookie(CookieName); err == nil {
		if id, ok := s.verify(c.Value); ok {
			if sess := s.get(id); sess != nil {
				sess.FP = fp
				sess.IP = ip
				return sess, ""
			}
			// Valid signature but evicted session: rebuild under same id.
			sess := s.create(id, ip, fp)
			return sess, ""
		}
	}

	// Fallback identity: IP + coarse fingerprint. This stops a client from
	// cheaply resetting its score by dropping the cookie.
	fallbackID := s.derive(ip + "|" + fp.ID)
	if sess := s.get(fallbackID); sess != nil {
		sess.FP = fp
		return sess, s.sign(fallbackID)
	}
	sess := s.create(fallbackID, ip, fp)
	return sess, s.sign(fallbackID)
}

func (s *Store) get(id string) *Session {
	s.mu.RLock()
	sess := s.byID[id]
	s.mu.RUnlock()
	return sess
}

func (s *Store) create(id, ip string, fp fingerprint.Print) *Session {
	s.mu.Lock()
	defer s.mu.Unlock()
	if sess := s.byID[id]; sess != nil {
		return sess
	}
	now := time.Now()
	sess := &Session{
		ID: id, IP: ip, FP: fp, Created: now, LastSeen: now,
		cap: s.cap, Rung: "monitor",
	}
	s.byID[id] = sess
	s.gcLocked(now)
	return sess
}

// Snapshot returns all live sessions (for the dashboard).
func (s *Store) Snapshot() []*Session {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]*Session, 0, len(s.byID))
	for _, v := range s.byID {
		out = append(out, v)
	}
	return out
}

// Count returns the number of live sessions.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byID)
}

func (s *Store) gcLocked(now time.Time) {
	if now.Sub(s.lastGC) < time.Minute {
		return
	}
	s.lastGC = now
	for id, sess := range s.byID {
		if now.Sub(sess.LastSeen) > s.ttl {
			delete(s.byID, id)
		}
	}
}

// --- cookie signing ---

func (s *Store) sign(id string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(id))
	sig := hex.EncodeToString(mac.Sum(nil)[:16])
	return id + "." + sig
}

func (s *Store) verify(val string) (string, bool) {
	i := strings.LastIndexByte(val, '.')
	if i < 0 {
		return "", false
	}
	id, sig := val[:i], val[i+1:]
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(id))
	want := hex.EncodeToString(mac.Sum(nil)[:16])
	if hmac.Equal([]byte(sig), []byte(want)) {
		return id, true
	}
	return "", false
}

func (s *Store) derive(material string) string {
	mac := hmac.New(sha256.New, s.secret)
	mac.Write([]byte(material))
	return hex.EncodeToString(mac.Sum(nil)[:12])
}

// clientIP extracts the best client IP, honouring X-Forwarded-For's leftmost
// entry only when present (Mirage is typically the edge, so RemoteAddr is
// usually authoritative; XFF is used when behind a trusted LB).
func clientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		if i := strings.IndexByte(xff, ','); i >= 0 {
			return strings.TrimSpace(xff[:i])
		}
		return strings.TrimSpace(xff)
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}
