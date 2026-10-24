package honeytoken

import (
	"regexp"
	"testing"
)

// Core safety contract: no minted token may match a real provider key shape.
func TestMintedTokensAreInert(t *testing.T) {
	s := NewStore("mrg", nil)
	realShapes := []*regexp.Regexp{
		regexp.MustCompile(`^sk_live_[0-9a-zA-Z]{24,}$`),
		regexp.MustCompile(`^AKIA[0-9A-Z]{16}$`),
		regexp.MustCompile(`^ghp_[0-9A-Za-z]{36}$`),
		regexp.MustCompile(`^AIza[0-9A-Za-z\-_]{35}$`),
	}
	kinds := []Kind{KindAPIKey, KindPassword, KindAWSKey, KindJWT, KindURL, KindEnvFile}
	for _, k := range kinds {
		for i := 0; i < 50; i++ {
			tok := s.Mint(k, "sess", "fp", "/t", "f")
			for _, re := range realShapes {
				if re.MatchString(tok.Value) {
					t.Errorf("kind %s minted a real-looking credential: %q matches %q", k, tok.Value, re)
				}
			}
		}
	}
}

// Deterministic Format: same seed → same value (needed for shadow consistency).
func TestFormatDeterministic(t *testing.T) {
	s := NewStore("mrg", nil)
	a := s.Format(KindAPIKey, "deadbeefdeadbeef")
	b := s.Format(KindAPIKey, "deadbeefdeadbeef")
	if a != b {
		t.Errorf("Format not deterministic: %q vs %q", a, b)
	}
	c := s.Format(KindAPIKey, "feedfacefeedface")
	if a == c {
		t.Errorf("different seeds produced identical tokens")
	}
}

// A trip fires the alert exactly, carrying the originating session fingerprint.
func TestTripDetectionAndAlert(t *testing.T) {
	var fired *Trip
	s := NewStore("mrg", func(tr Trip) { fired = &tr })
	tok := s.Mint(KindAPIKey, "planter-sess", "fp-abc", "/api/config", "api_key")

	// Scan a request body that contains the token.
	got, ok := s.Scan("POST /login key=" + tok.Value + "&x=1")
	if !ok {
		t.Fatal("token not detected in scanned text")
	}
	s.Report(got, "attacker-sess", "fp-xyz", "request", "/login")
	if fired == nil {
		t.Fatal("trip alert did not fire")
	}
	if fired.Token.SessionID != "planter-sess" {
		t.Errorf("trip lost the planting session id: %q", fired.Token.SessionID)
	}
	if fired.FromSession != "attacker-sess" || fired.FromFP != "fp-xyz" {
		t.Errorf("trip did not carry the presenting session fingerprint")
	}
}

// Scan fast-path: text without the reserved marker never scans the map.
func TestScanFastPath(t *testing.T) {
	s := NewStore("mrg", nil)
	s.Mint(KindAPIKey, "s", "f", "/t", "k")
	if _, ok := s.Scan("GET /products?id=42 normal traffic"); ok {
		t.Errorf("benign text should not match any token")
	}
}
