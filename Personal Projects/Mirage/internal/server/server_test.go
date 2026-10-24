package server

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

func buildApp(t *testing.T, origin string, mutate func(*config.Config)) *App {
	t.Helper()
	cfg := config.Default()
	cfg.Origin = origin
	cfg.ServerSecret = "test"
	if mutate != nil {
		mutate(&cfg)
	}
	app, err := Build(&cfg)
	if err != nil {
		t.Fatal(err)
	}
	return app
}

// Full pipeline, monitor mode: everything scores and logs but nothing is
// enforced — the origin always serves.
func TestEndToEndMonitorMode(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "origin:"+r.URL.Path)
	}))
	defer origin.Close()
	app := buildApp(t, origin.URL, nil)
	defer app.Close()

	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	// Even a request that trips the virtual-patch pack passes through in
	// monitor mode (the violation is recorded, not enforced).
	resp, err := http.Get(ts.URL + "/php2shell")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "origin:/php2shell" {
		t.Errorf("monitor mode should pass through, got %q", body)
	}
}

// Enforce mode: the ingress virtual-patch pack rejects the exploit shape.
func TestEndToEndEnforceRejects(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "SHOULD-NOT-REACH")
	}))
	defer origin.Close()
	app := buildApp(t, origin.URL, func(c *config.Config) { c.Mode = "enforce" })
	defer app.Close()

	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/php2shell")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusForbidden {
		t.Errorf("enforce mode should reject php2shell shape, status=%d", resp.StatusCode)
	}
}

// Latency budget: Mirage's added latency (everything before origin dispatch)
// must stay well under the 2 ms p50 target with the full pipeline wired.
func TestLatencyBudget(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "ok")
	}))
	defer origin.Close()
	app := buildApp(t, origin.URL, func(c *config.Config) { c.Mode = "enforce" })
	defer app.Close()

	ts := httptest.NewServer(app.Proxy)
	defer ts.Close()

	client := ts.Client()
	// Warm + many requests so the latency histogram fills.
	for i := 0; i < 2000; i++ {
		resp, err := client.Get(ts.URL + "/products/42")
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
	p50, p95, p99 := app.Metrics.LatencyPercentiles()
	t.Logf("Mirage added latency: p50=%.3fms p95=%.3fms p99=%.3fms", p50, p95, p99)
	if p50 > 2.0 {
		t.Errorf("p50 added latency %.3fms exceeds 2ms budget", p50)
	}
}
