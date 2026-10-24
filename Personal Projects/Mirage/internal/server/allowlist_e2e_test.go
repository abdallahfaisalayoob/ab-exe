package server

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// A health-check path must never be shadowed/challenged, even in full enforce
// mode with the shadow rung reachable — the allowlist pins it to monitor.
func TestAllowlistedPathNeverShadowed(t *testing.T) {
	t.Setenv("MIRAGE_EXPOSE_RUNG", "1")
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ORIGIN:"+r.URL.Path)
	}))
	defer origin.Close()

	app := buildApp(t, origin.URL, func(c *config.Config) {
		c.Mode = "enforce"
		c.Ladder.Enabled = true
		c.Ladder.MaxRung = "shadow"
		c.Ladder.TarpitDelayMS = 1
		c.Shadow.Enabled = true
		c.Shadow.MinAgent = 0
		c.Shadow.MinHostile = 0
		c.Ladder.PoWThreshold = 1
		c.Ladder.ShadowMin = 1
		c.Ladder.TarpitMin = 100000
		c.Ladder.BlockMin = 100000
		c.Allowlist.Paths = []string{"/healthz"}
	})
	defer app.Close()
	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	// Drive the SAME session into a hostile score via enumeration...
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	for _, p := range []string{"/admin", "/.env", "/wp-admin", "/x", "/y"} {
		req, _ := http.NewRequest("GET", ts.URL+p, nil)
		req.Header.Set("User-Agent", "python-requests/2.31.0")
		if resp, err := client.Do(req); err == nil {
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
		}
	}
	// ...then hit the allowlisted health path on that hostile session.
	req, _ := http.NewRequest("GET", ts.URL+"/healthz", nil)
	req.Header.Set("User-Agent", "python-requests/2.31.0")
	resp, err := client.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	rung := resp.Header.Get("X-Mirage-Rung")
	if rung != "" && rung != "monitor" {
		t.Errorf("allowlisted path escalated to %q", rung)
	}
	if !strings.HasPrefix(string(body), "ORIGIN:") {
		t.Errorf("allowlisted path did not reach origin: %q", body)
	}
}
