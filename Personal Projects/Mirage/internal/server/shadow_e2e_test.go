package server

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// End-to-end: a session scored into the shadow rung receives a fabricated
// response (never the origin), and presenting a planted honeytoken back to
// Mirage fires a critical trip alert carrying the session fingerprint.
func TestShadowAndHoneytokenTrip(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = io.WriteString(w, `{"id":1,"email":"real@corp.com","api_key":"REAL-SECRET-DO-NOT-LEAK"}`)
	}))
	defer origin.Close()

	app := buildApp(t, origin.URL, func(c *config.Config) {
		c.Mode = "enforce"
		c.Ladder.Enabled = true
		c.Ladder.MaxRung = "shadow"
		c.Ladder.TarpitDelayMS = 1
		c.Shadow.Enabled = true
		c.Shadow.MinAgent = 0 // force-eligible for the test
		c.Shadow.MinHostile = 0
		c.Ladder.ShadowMin = 1 // anything scored >=1 shadows (test convenience)
		c.Ladder.PoWThreshold = 100000
		c.Ladder.TarpitMin = 100000
		c.Ladder.BlockMin = 100000
	})
	defer app.Close()
	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	// Build a session with a non-trivial score by enumerating missing paths.
	jar := newJar(t)
	client := &http.Client{Jar: jar}
	for _, p := range []string{"/admin", "/.git/config", "/api/x", "/api/y", "/wp-admin"} {
		req, _ := http.NewRequest("GET", ts.URL+p, nil)
		req.Header.Set("User-Agent", "python-requests/2.31.0")
		resp, _ := client.Do(req)
		if resp != nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}

	// Now request an API route; the shadow engine should fabricate it and the
	// REAL secret must never appear.
	req, _ := http.NewRequest("GET", ts.URL+"/api/users/42", nil)
	req.Header.Set("User-Agent", "python-requests/2.31.0")
	req.Header.Set("Accept", "application/json")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if strings.Contains(string(body), "REAL-SECRET-DO-NOT-LEAK") {
		t.Fatalf("shadow leaked the real origin secret: %s", body)
	}

	// Ensure some tokens are planted: fetch a fake .env (always plants).
	envReq, _ := http.NewRequest("GET", ts.URL+"/.env", nil)
	envReq.Header.Set("User-Agent", "python-requests/2.31.0")
	if er, e := client.Do(envReq); e == nil {
		io.Copy(io.Discard, er.Body)
		er.Body.Close()
	}
	tok, ok := app.honeytoken.Sample()
	if !ok {
		t.Fatal("no honeytoken was planted by shadowing")
	}

	tripsBefore := len(app.honeytoken.Trips())
	// Present the token back via the check API (mounted on the admin handler).
	checkBody, _ := json.Marshal(map[string]string{"token": tok.Value, "source": "pastebin-dump"})
	rec := httptest.NewRecorder()
	app.Admin.ServeHTTP(rec, httptest.NewRequest("POST", "/_mirage/api/check", strings.NewReader(string(checkBody))))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"match":true`) {
		t.Fatalf("check API did not confirm the token: %d %s", rec.Code, rec.Body.String())
	}
	if len(app.honeytoken.Trips()) <= tripsBefore {
		t.Errorf("presenting a planted token did not record a trip")
	}

	// Presenting the same token in a normal request must also trip.
	badReq, _ := http.NewRequest("GET", ts.URL+"/account?key="+tok.Value, nil)
	if br, e := client.Do(badReq); e == nil {
		io.Copy(io.Discard, br.Body)
		br.Body.Close()
	}
	if len(app.honeytoken.Trips()) < tripsBefore+2 {
		t.Errorf("token replayed in a request did not trip")
	}
}

func newJar(t *testing.T) http.CookieJar {
	t.Helper()
	jar, err := cookiejar.New(nil)
	if err != nil {
		t.Fatal(err)
	}
	return jar
}
