package shadow

import (
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/honeytoken"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// RED-TEAM #1: can an agent spot the shadow? Fake ordinary data must not carry
// tell-tale reserved markers (.invalid) — only honeytokens do.
func TestShadowFakeDataHasNoReservedTell(t *testing.T) {
	ht := honeytoken.NewStore("mrg", nil)
	e := New([]byte("k"), ht, NewStore(), Config{})
	sc := &Schema{IsJSON: true, Root: &node{Kind: kObject,
		Keys: []string{"email", "avatar", "name"},
		Fields: map[string]*node{
			"email":  {Kind: kEmail, FieldName: "email"},
			"avatar": {Kind: kURL, FieldName: "avatar"},
			"name":   {Kind: kName, FieldName: "name"},
		}}}
	body, _ := e.GenerateJSON(sc, "s", "fp", "/api/users/{id}", "/api/users/5")
	s := string(body)
	if strings.Contains(s, ".invalid") {
		t.Errorf("shadow leaked a reserved-TLD tell in ordinary data: %s", s)
	}
	// It should still be valid, structurally-correct JSON.
	var v map[string]any
	if err := json.Unmarshal(body, &v); err != nil {
		t.Fatalf("shadow produced invalid JSON: %v", err)
	}
}

// RED-TEAM #1 (timing): a shadow response must not return in ~0 time.
func TestShadowAddsLatency(t *testing.T) {
	e := New([]byte("k"), honeytoken.NewStore("mrg", nil), NewStore(), Config{})
	s := session.New("s", 8)
	r := httptest.NewRequest("GET", "/api/users/1", nil)
	w := httptest.NewRecorder()
	start := time.Now()
	e.Handle(w, r, s)
	if time.Since(start) < 10*time.Millisecond {
		t.Errorf("shadow response returned suspiciously fast: %v", time.Since(start))
	}
}

// RED-TEAM #1 (replay): repeated identical requests must give byte-identical
// shadow bodies (already covered broadly, reasserted here as a red-team gate).
func TestShadowReplayStable(t *testing.T) {
	e := New([]byte("k"), honeytoken.NewStore("mrg", nil), NewStore(), Config{HoneytokenEnv: true})
	run := func() string {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("GET", "/api/v1/account", nil)
		r.Header.Set("Accept", "application/json")
		e.Handle(w, r, session.New("fixed-session", 8))
		return w.Body.String()
	}
	// Same session id is rebuilt each call (session.New), but the generator is
	// seeded by id string, so output must match.
	if run() != run() {
		t.Errorf("shadow not stable across identical replays")
	}
}
