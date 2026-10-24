package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// End-to-end: a zero-day-style response leaking a private key and an oversized
// session cookie (PHP2Shell shape) is scrubbed before it reaches the client,
// even though the request looked entirely normal.
func TestLeakFilterEndToEnd(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Add("Set-Cookie", "PHPSESSID="+strings.Repeat("Z", 70000)) // memory leak
		w.Header().Set("Content-Type", "text/plain")
		_, _ = io.WriteString(w, "ok\n-----BEGIN RSA PRIVATE KEY-----\nLEAKEDKEYDATA\n-----END RSA PRIVATE KEY-----\n")
	}))
	defer origin.Close()

	app := buildApp(t, origin.URL, func(c *config.Config) {
		c.Mode = "enforce"
		c.Leak.Enabled = true
	})
	defer app.Close()
	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/normal-looking-path")
	if err != nil {
		t.Fatal(err)
	}
	body, _ := io.ReadAll(resp.Body)
	resp.Body.Close()

	if strings.Contains(string(body), "LEAKEDKEYDATA") {
		t.Errorf("private key leaked to client: %s", body)
	}
	for _, c := range resp.Cookies() {
		if c.Name == "PHPSESSID" && len(c.Value) > 1000 {
			t.Errorf("oversized cookie leaked: %d bytes", len(c.Value))
		}
	}
}
