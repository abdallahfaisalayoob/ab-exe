package shadow

import (
	"encoding/json"
	"net/http/httptest"
	"regexp"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/honeytoken"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

func newEngine(t *testing.T) (*Engine, *honeytoken.Store) {
	t.Helper()
	ht := honeytoken.NewStore("mrg", nil)
	e := New([]byte("secret-key-123"), ht, NewStore(), Config{HoneytokenEnv: true})
	return e, ht
}

// The fake must be IDENTICAL for the same session + route + id across repeated
// requests — otherwise an agent detects the fake by replaying a request.
func TestShadowConsistencyWithinSession(t *testing.T) {
	e, _ := newEngine(t)
	sc := &Schema{IsJSON: true, Root: &node{Kind: kObject,
		Keys: []string{"id", "email", "name"},
		Fields: map[string]*node{
			"id":    {Kind: kInt, FieldName: "id"},
			"email": {Kind: kEmail, FieldName: "email"},
			"name":  {Kind: kName, FieldName: "name"},
		}}}
	b1, _ := e.GenerateJSON(sc, "sessA", "fp1", "/api/users/{id}", "/api/users/42")
	b2, _ := e.GenerateJSON(sc, "sessA", "fp1", "/api/users/{id}", "/api/users/42")
	if string(b1) != string(b2) {
		t.Errorf("same session+id produced different fakes:\n%s\n---\n%s", b1, b2)
	}
	// A different id in the same session should differ.
	b3, _ := e.GenerateJSON(sc, "sessA", "fp1", "/api/users/{id}", "/api/users/99")
	if string(b1) == string(b3) {
		t.Errorf("different ids produced identical fakes")
	}
	// A different session should differ (per-session shadow).
	b4, _ := e.GenerateJSON(sc, "sessB", "fp2", "/api/users/{id}", "/api/users/42")
	if string(b1) == string(b4) {
		t.Errorf("different sessions produced identical fakes")
	}
}

// Honeytokens planted in a secret-shaped field must be inert and registered.
func TestPlantedTokensAreInertAndTracked(t *testing.T) {
	e, ht := newEngine(t)
	sc := &Schema{IsJSON: true, Root: &node{Kind: kObject,
		Keys:   []string{"api_key", "password"},
		Fields: map[string]*node{
			"api_key":  {Kind: kSecret, FieldName: "api_key"},
			"password": {Kind: kSecret, FieldName: "password"},
		}}}
	body, planted := e.GenerateJSON(sc, "s", "fp", "/api/config", "/api/config")
	if len(planted) != 2 {
		t.Fatalf("expected 2 planted tokens, got %d", len(planted))
	}
	// Each planted token must be findable in the store (tracked).
	for _, tok := range planted {
		if _, ok := ht.Check(tok.Value); !ok {
			t.Errorf("planted token not registered: %s", tok.Value)
		}
	}
	// Inertness: no planted value may match common REAL provider key regexes.
	assertInert(t, string(body))
}

// Inertness check against real-provider key shapes.
func assertInert(t *testing.T, s string) {
	t.Helper()
	realKeyShapes := []*regexp.Regexp{
		regexp.MustCompile(`sk_live_[0-9a-zA-Z]{24,}`),        // Stripe live secret
		regexp.MustCompile(`AKIA[0-9A-Z]{16}`),                 // real AWS access key id (exactly 16 after AKIA)
		regexp.MustCompile(`ghp_[0-9A-Za-z]{36}`),              // GitHub PAT
		regexp.MustCompile(`AIza[0-9A-Za-z\-_]{35}`),           // Google API key
		regexp.MustCompile(`xox[baprs]-[0-9A-Za-z\-]{10,}`),    // Slack token
	}
	for _, re := range realKeyShapes {
		if re.MatchString(s) {
			t.Errorf("planted content matches a REAL provider key shape %q: %s", re, re.FindString(s))
		}
	}
	// Positive: our tokens carry the reserved marker.
	if !strings.Contains(s, "mrg") && !strings.Contains(s, "AKIAmrg") {
		t.Errorf("expected reserved mrg marker in planted content")
	}
}

// A fake .env must be seeded with tracked, inert tokens.
func TestHoneyEnvEndpoint(t *testing.T) {
	e, ht := newEngine(t)
	s := session.New("sx", 8)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/.env", nil)
	if !e.Handle(w, r, s) {
		t.Fatal("env endpoint not handled")
	}
	body := w.Body.String()
	if !strings.Contains(body, "DB_PASSWORD=") || !strings.Contains(body, "AWS_ACCESS_KEY_ID=") {
		t.Errorf(".env missing expected keys:\n%s", body)
	}
	assertInert(t, body)
	if ht.Count() == 0 {
		t.Errorf("env endpoint planted no tracked tokens")
	}
	// TEST-NET-1 address, not a routable host.
	if !strings.Contains(body, "192.0.2.") {
		t.Errorf(".env DB_HOST should be TEST-NET-1")
	}
}

// Unknown JSON API route synthesises a plausible, consistent fake.
func TestSynthesiseUnknownRoute(t *testing.T) {
	e, _ := newEngine(t)
	s := session.New("sy", 8)
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/api/v1/secrets", nil)
	r.Header.Set("Accept", "application/json")
	if !e.Handle(w, r, s) {
		t.Fatal("not handled")
	}
	var v map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &v); err != nil {
		t.Fatalf("synthesised body is not valid JSON: %v\n%s", err, w.Body.String())
	}
	if _, ok := v["api_key"]; !ok {
		t.Errorf("expected an api_key honeytoken slot in synthesised object")
	}
}
