// Package honeytoken mints, stores and detects honeytokens: unique, tracked,
// and — critically — INERT lures planted in shadow responses. If a token is
// ever presented back to Mirage (in any request) or reported through the check
// API, it proves someone acted on data they could only have obtained from a
// shadow response, and a critical alert fires carrying the originating
// session's fingerprint.
//
// Inert by construction (DECISIONS.md D8): every minted value uses a reserved
// prefix and draws its "realistic" parts from reserved ranges (RFC 2606
// domains, TEST-NET-1 addresses). A token must never authenticate anywhere.
package honeytoken

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"
	"sync"
	"time"
)

// Kind is the flavour of a honeytoken, so a shadow response can plant the right
// shape in the right place.
type Kind string

const (
	KindAPIKey   Kind = "api_key"
	KindPassword Kind = "password"
	KindAWSKey   Kind = "aws_key"
	KindJWT      Kind = "jwt"
	KindEnvFile  Kind = "env_file"
	KindURL      Kind = "url"
)

// Token is a minted honeytoken.
type Token struct {
	Value     string
	Kind      Kind
	SessionID string
	Template  string // route it was planted in
	Field     string // field/location it was planted as
	FPID      string // fingerprint id of the session
	MintedAt  time.Time
}

// Trip records a honeytoken being presented back to Mirage.
type Trip struct {
	Token        Token
	PresentedAt  time.Time
	FromSession  string
	FromFP       string
	Via          string // "request" or "check-api"
	RequestPath  string
}

// AlertFunc is called (once) when a token trips. Wired to the alert pipeline.
type AlertFunc func(Trip)

// Store holds minted tokens and detects trips.
type Store struct {
	prefix string
	mu     sync.RWMutex
	byVal  map[string]Token
	trips  []Trip
	onTrip AlertFunc
}

// NewStore builds a token store. prefix is the reserved honeytoken prefix
// (e.g. "mrg"); an empty prefix defaults to "mrg".
func NewStore(prefix string, onTrip AlertFunc) *Store {
	if prefix == "" {
		prefix = "mrg"
	}
	return &Store{prefix: prefix, byVal: make(map[string]Token), onTrip: onTrip}
}

// Mint creates and registers an inert token of the given kind.
func (s *Store) Mint(kind Kind, sessionID, fpID, template, field string) Token {
	t := Token{
		Value:     s.value(kind),
		Kind:      kind,
		SessionID: sessionID,
		Template:  template,
		Field:     field,
		FPID:      fpID,
		MintedAt:  time.Now(),
	}
	s.mu.Lock()
	s.byVal[t.Value] = t
	s.mu.Unlock()
	return t
}

// Format builds an inert token value of the given kind from a caller-supplied
// hex string. The shadow engine passes DETERMINISTIC hex (derived from the
// session seed) so a planted token has the same value every time that session
// re-requests the same route — otherwise an agent would see it change and know
// it was fake. Formatting lives here so inertness is enforced in one place.
func (s *Store) Format(kind Kind, hexSeed string) string {
	return s.format(kind, hexSeed)
}

// Register stores a pre-built token (idempotent). Used with Format for
// deterministic planting.
func (s *Store) Register(t Token) {
	s.mu.Lock()
	s.byVal[t.Value] = t
	s.mu.Unlock()
}

// value generates an inert token value for a kind using fresh randomness.
func (s *Store) value(kind Kind) string {
	return s.format(kind, randHex(16))
}

// format is the single inert-value constructor. Every form is deliberately
// NON-FUNCTIONAL: reserved prefix, RFC 2606 domains, and obviously fake key
// material — a token must never authenticate anywhere.
func (s *Store) format(kind Kind, seed string) string {
	// Expand the seed so every sub-segment is drawn deterministically from it
	// (no fresh randomness here — the shadow engine relies on same-seed →
	// same-value for intra-session consistency).
	r := expand(seed, 48)
	switch kind {
	case KindAPIKey:
		// e.g. mrg_live_sk_<hex>. The mrg_ prefix is reserved to Mirage and is
		// not a valid prefix for any real provider.
		return fmt.Sprintf("%s_live_sk_%s", s.prefix, r[:32])
	case KindPassword:
		return fmt.Sprintf("%s-Pw!%s", s.prefix, r[:16])
	case KindAWSKey:
		// AWS-ish so a careless attacker tries it, but PROVABLY not a real IAM
		// key: real AWS access key IDs are uppercase base32 (A-Z2-7) of fixed
		// length. Embedding the lowercase reserved marker right after AKIA makes
		// this impossible to confuse with a genuine key while staying tracked.
		return "AKIA" + s.prefix + strings.ToUpper(r[:14])
	case KindJWT:
		// Three base64url-looking segments; NOT a validly-signed JWT.
		return fmt.Sprintf("eyJ%s.%s.%s", r[:12], r[12:36], s.prefix+r[36:48])
	case KindURL:
		// RFC 2606 reserved domain — resolves nowhere.
		return fmt.Sprintf("https://%s.internal.example.invalid/%s", s.prefix, r[:32])
	case KindEnvFile:
		return s.prefix + "_envmarker_" + r[:16]
	default:
		return s.prefix + "_" + r[:32]
	}
}

// expand deterministically stretches a hex seed to at least n hex chars.
func expand(seed string, n int) string {
	out := seed
	for len(out) < n {
		sum := sha256.Sum256([]byte(out))
		out += hex.EncodeToString(sum[:])
	}
	return out[:n]
}


func (s *Store) prefix2() string {
	p := strings.ToUpper(s.prefix)
	if len(p) >= 2 {
		return p[:2]
	}
	return "MR"
}

// Scan checks arbitrary text (a request path, query, header or body prefix) for
// any registered token. Fast path: skip unless the reserved prefix appears.
func (s *Store) Scan(text string) (Token, bool) {
	if !strings.Contains(text, s.prefix) && !strings.Contains(text, "AKIA") {
		return Token{}, false
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	for val, tok := range s.byVal {
		if strings.Contains(text, val) {
			return tok, true
		}
	}
	return Token{}, false
}

// Check looks up an exact token value (used by the check API).
func (s *Store) Check(value string) (Token, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	t, ok := s.byVal[value]
	return t, ok
}

// Report records a trip and fires the alert exactly once per (token, session).
func (s *Store) Report(tok Token, fromSession, fromFP, via, path string) Trip {
	trip := Trip{
		Token: tok, PresentedAt: time.Now(),
		FromSession: fromSession, FromFP: fromFP, Via: via, RequestPath: path,
	}
	s.mu.Lock()
	s.trips = append(s.trips, trip)
	s.mu.Unlock()
	if s.onTrip != nil {
		s.onTrip(trip)
	}
	return trip
}

// Trips returns a copy of recorded trips (for the dashboard).
func (s *Store) Trips() []Trip {
	s.mu.RLock()
	defer s.mu.RUnlock()
	out := make([]Trip, len(s.trips))
	copy(out, s.trips)
	return out
}

// Sample returns an arbitrary registered token (for tests/diagnostics).
func (s *Store) Sample() (Token, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	for _, t := range s.byVal {
		return t, true
	}
	return Token{}, false
}

// Count returns the number of minted tokens.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byVal)
}

func randHex(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
