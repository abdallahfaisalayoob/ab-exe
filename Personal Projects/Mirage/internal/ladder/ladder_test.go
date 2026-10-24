package ladder

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

func TestDecideThresholdsAndClamp(t *testing.T) {
	cfg := config.Default().Ladder
	cfg.MaxRung = "block"
	cases := []struct {
		score int
		want  Rung
	}{
		{10, RungMonitor},
		{55, RungPoW},
		{70, RungTarpit},
		{82, RungShadow},
		{95, RungBlock},
		{100, RungBlock},
	}
	for _, c := range cases {
		if got := Decide(c.score, cfg); got != c.want {
			t.Errorf("score %d: got %v want %v", c.score, got, c.want)
		}
	}

	// Clamp: with max_rung=pow, a shadow-level score only reaches pow.
	cfg.MaxRung = "pow"
	if got := Decide(95, cfg); got != RungPoW {
		t.Errorf("clamp failed: got %v want pow", got)
	}

	// Default max_rung=monitor => nothing fires regardless of score.
	cfg2 := config.Default().Ladder
	if got := Decide(99, cfg2); got != RungMonitor {
		t.Errorf("default should clamp to monitor, got %v", got)
	}
}

func TestPoWRoundTrip(t *testing.T) {
	bits := 12
	challenge := "session-abc"
	nonce := SolvePoW(challenge, bits)
	if !VerifyPoW(challenge, challenge+":"+nonce, bits) {
		t.Errorf("valid solution rejected")
	}
	if VerifyPoW(challenge, challenge+":0", bits) && nonce != "0" {
		t.Errorf("nonce 0 should not usually verify at %d bits", bits)
	}
	// Wrong challenge binding is rejected.
	if VerifyPoW(challenge, "other:"+nonce, bits) {
		t.Errorf("solution bound to a different challenge accepted")
	}
}

func TestPoWServeThenClear(t *testing.T) {
	cfg := config.Default().Ladder
	cfg.PoWDifficulty = 10
	l := New(cfg, nil, false)
	s := session.New("sess1", 16)

	// First contact: a challenge is issued.
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	if !l.servePoW(w, r, s) {
		t.Fatal("expected a challenge to be served")
	}
	ch := w.Header().Get("X-Mirage-Challenge")
	if ch == "" {
		t.Fatal("no challenge header")
	}

	// Solve and resubmit.
	nonce := SolvePoW(ch, cfg.PoWDifficulty)
	r2 := httptest.NewRequest("GET", "/", nil)
	r2.Header.Set("X-Mirage-PoW", ch+":"+nonce)
	w2 := httptest.NewRecorder()
	if l.servePoW(w2, r2, s) {
		t.Fatal("valid solution should let the request proceed (return false)")
	}
	if !time.Now().Before(s.PoWClearedUntil) {
		t.Fatal("session not marked cleared")
	}

	// A later request within the window proceeds without a challenge.
	w3 := httptest.NewRecorder()
	if l.servePoW(w3, httptest.NewRequest("GET", "/", nil), s) {
		t.Fatal("cleared session should not be re-challenged")
	}
}

func TestShadowFallbackToTarpit(t *testing.T) {
	cfg := config.Default().Ladder
	cfg.TarpitDelayMS = 1
	l := New(cfg, nil, false) // no shadow handler
	r := httptest.NewRequest("GET", "/", nil)
	w := httptest.NewRecorder()
	handled := l.Serve(RungShadow, w, r, session.New("s", 8))
	if !handled {
		t.Fatal("shadow rung must handle the response (fell through to origin)")
	}
	if w.Code != http.StatusOK {
		t.Errorf("tarpit fallback status=%d", w.Code)
	}
}

func TestBlockRung(t *testing.T) {
	l := New(config.Default().Ladder, nil, false)
	w := httptest.NewRecorder()
	l.Serve(RungBlock, w, httptest.NewRequest("GET", "/", nil), nil)
	if w.Code != http.StatusForbidden {
		t.Errorf("block status=%d want 403", w.Code)
	}
}
