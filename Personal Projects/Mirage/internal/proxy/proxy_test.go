package proxy

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/metrics"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

func newTestProxy(t *testing.T, origin string, hooks Hooks) *Proxy {
	t.Helper()
	cfg := config.Default()
	cfg.Origin = origin
	cfg.Mode = "enforce"
	m := metrics.New()
	ss := session.NewStore("test-secret", 32)
	p, err := New(&cfg, ss, m, hooks)
	if err != nil {
		t.Fatalf("New: %v", err)
	}
	return p
}

func TestTransparentProxy(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Origin", "yes")
		w.WriteHeader(201)
		_, _ = io.WriteString(w, "hello "+r.URL.Path)
	}))
	defer origin.Close()

	p := newTestProxy(t, origin.URL, Hooks{})
	ts := httptest.NewServer(p)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/foo/bar")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != 201 {
		t.Errorf("status = %d, want 201", resp.StatusCode)
	}
	if resp.Header.Get("X-Origin") != "yes" {
		t.Errorf("origin header not forwarded")
	}
	if string(body) != "hello /foo/bar" {
		t.Errorf("body = %q", body)
	}
	// A Mirage session cookie should be set on first contact.
	var found bool
	for _, c := range resp.Cookies() {
		if c.Name == session.CookieName {
			found = true
		}
	}
	if !found {
		t.Errorf("session cookie not set")
	}
}

// A hook that panics must not break the response: fail open to the origin.
func TestFailOpenOnHookPanic(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "origin-served")
	}))
	defer origin.Close()

	hooks := Hooks{
		Ingress: func(ctx *Context) Decision { panic("boom in ingress") },
		Score:   func(ctx *Context) { panic("boom in score") },
	}
	p := newTestProxy(t, origin.URL, hooks)
	ts := httptest.NewServer(p)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "origin-served" {
		t.Errorf("expected origin to serve despite panics, got %q", body)
	}
}

// Kill switch => pure pass-through, hooks never run.
func TestKillSwitch(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "origin")
	}))
	defer origin.Close()

	var ingressRan bool
	hooks := Hooks{Ingress: func(ctx *Context) Decision { ingressRan = true; return Served }}
	p := newTestProxy(t, origin.URL, hooks)
	p.cfg.KillSwitch = true

	ts := httptest.NewServer(p)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if string(body) != "origin" {
		t.Errorf("kill switch should pass through to origin, got %q", body)
	}
	if ingressRan {
		t.Errorf("hooks must not run under kill switch")
	}
}

// Origin down => clean 502, no crash (availability preserved).
func TestOriginDownFailsClean(t *testing.T) {
	// Point at a closed port.
	p := newTestProxy(t, "http://127.0.0.1:1", Hooks{})
	ts := httptest.NewServer(p)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusBadGateway {
		t.Errorf("status = %d, want 502", resp.StatusCode)
	}
}

func TestServedShortCircuits(t *testing.T) {
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.WriteString(w, "SHOULD-NOT-REACH")
	}))
	defer origin.Close()

	hooks := Hooks{
		Ladder: func(ctx *Context) Decision {
			ctx.W.WriteHeader(403)
			_, _ = io.WriteString(ctx.W, "blocked")
			return Served
		},
	}
	p := newTestProxy(t, origin.URL, hooks)
	ts := httptest.NewServer(p)
	defer ts.Close()

	resp, err := http.Get(ts.URL + "/")
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if !strings.Contains(string(body), "blocked") {
		t.Errorf("ladder Served response not used, got %q", body)
	}
}
