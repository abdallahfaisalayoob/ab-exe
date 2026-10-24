package server

import (
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// With the ladder enabled in enforce mode, a scanner-shaped session (rapid,
// broad, high-404 enumeration) must escalate off the monitor rung, while a
// human-shaped session keeps getting origin responses.
func TestLadderEscalatesScannerNotHuman(t *testing.T) {
	t.Setenv("MIRAGE_EXPOSE_RUNG", "1")

	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Everything outside a tiny real surface 404s (so enumeration shows).
		switch r.URL.Path {
		case "/", "/products", "/about":
			_, _ = io.WriteString(w, "real")
		default:
			w.WriteHeader(404)
			_, _ = io.WriteString(w, "nope")
		}
	}))
	defer origin.Close()

	app := buildApp(t, origin.URL, func(c *config.Config) {
		c.Mode = "enforce"
		c.Ladder.Enabled = true
		c.Ladder.MaxRung = "block"
		c.Ladder.TarpitDelayMS = 1
		c.Ladder.PoWDifficulty = 8
	})
	defer app.Close()
	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	// Scanner: one cookie jar (one session), many distinct 404 paths, fast.
	jar, _ := cookiejar.New(nil)
	client := &http.Client{Jar: jar}
	wordlist := []string{"/admin", "/.env", "/wp-admin", "/config.php", "/backup.zip",
		"/.git/config", "/phpinfo.php", "/api/admin", "/shell.php", "/db.sql",
		"/old", "/dev", "/staging", "/.aws/credentials", "/users.json"}
	escalated := false
	for round := 0; round < 4; round++ {
		for _, p := range wordlist {
			req, _ := http.NewRequest("GET", ts.URL+p, nil)
			req.Header.Set("User-Agent", "python-requests/2.31.0")
			resp, err := client.Do(req)
			if err != nil {
				t.Fatal(err)
			}
			rung := resp.Header.Get("X-Mirage-Rung")
			io.Copy(io.Discard, resp.Body)
			resp.Body.Close()
			if rung != "" && rung != "monitor" {
				escalated = true
			}
		}
	}
	if !escalated {
		t.Errorf("scanner session never escalated off monitor")
	}

	// Human: browser headers, only real paths, its own session.
	hjar, _ := cookiejar.New(nil)
	hclient := &http.Client{Jar: hjar}
	for i := 0; i < 12; i++ {
		p := []string{"/", "/products", "/about"}[i%3]
		req, _ := http.NewRequest("GET", ts.URL+p, nil)
		req.Header.Set("User-Agent", "Mozilla/5.0 Chrome/130.0")
		req.Header.Set("Accept", "text/html")
		req.Header.Set("Accept-Language", "en-US")
		resp, err := hclient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		rung := resp.Header.Get("X-Mirage-Rung")
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if rung != "" && rung != "monitor" {
			t.Errorf("human request escalated to %q (false positive)", rung)
		}
	}
}
