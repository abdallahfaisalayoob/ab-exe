package ingress

import (
	"bytes"
	"io"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

func testGuard(t *testing.T) *Guard {
	t.Helper()
	g, err := New(config.Default().Ingress)
	if err != nil {
		t.Fatal(err)
	}
	return g
}

// Normal form submissions must pass untouched.
func TestNormalFormPasses(t *testing.T) {
	g := testGuard(t)
	body := "username=alice&password=hunter2&remember=1&csrf=abc123"
	r := httptest.NewRequest("POST", "/login", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if v := g.Inspect(r); v != nil {
		t.Fatalf("normal form rejected: %+v", v)
	}
	// Body must still be readable by the origin.
	got, _ := io.ReadAll(r.Body)
	if string(got) != body {
		t.Errorf("body not restored: %q", got)
	}
}

// The PHP2Shell shape: an oversized field NAME in a urlencoded body.
func TestPHP2ShellOversizedFieldName(t *testing.T) {
	g := testGuard(t)
	hugeName := strings.Repeat("A", 5000)
	body := hugeName + "=x"
	r := httptest.NewRequest("POST", "/index.php", strings.NewReader(body))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	v := g.Inspect(r)
	if v == nil {
		t.Fatal("oversized field name not caught")
	}
	if v.Rule != "form.fieldname" {
		t.Errorf("rule = %q, want form.fieldname", v.Rule)
	}
}

// Too many fields (field-flood shape).
func TestTooManyFields(t *testing.T) {
	g := testGuard(t)
	var b strings.Builder
	for i := 0; i < 5000; i++ {
		b.WriteString("f")
		b.WriteString(strings.Repeat("", 0))
		b.WriteString("=1&")
	}
	r := httptest.NewRequest("POST", "/", strings.NewReader(b.String()))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	if v := g.Inspect(r); v == nil || v.Rule != "form.fields" {
		t.Fatalf("field flood not caught: %+v", v)
	}
}

// Body larger than the cap even if Content-Length is understated.
func TestOversizedBodyBeyondContentLength(t *testing.T) {
	cfg := config.Default().Ingress
	cfg.MaxBodyBytes = 1024
	g, _ := New(cfg)
	big := bytes.Repeat([]byte("x"), 4096)
	r := httptest.NewRequest("POST", "/", bytes.NewReader(big))
	r.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	r.ContentLength = 10 // lie
	if v := g.Inspect(r); v == nil || v.Rule != "body.size" {
		t.Fatalf("oversized body not caught: %+v", v)
	}
}

// Virtual-patch pack catches known exploit shapes in the URI/query.
func TestVirtualPatchPack(t *testing.T) {
	g := testGuard(t)
	cases := []struct {
		path, rawQuery, wantRule string
	}{
		{"/app", "cmd=;id", "VP-shell-injection"},
		{"/../../../../etc/passwd", "", "VP-path-traversal"},
		// attacker-realistic: spaces URL-encoded as %20
		{"/api", "q=1%20UNION%20SELECT%20password%20FROM%20users", "VP-sqli-union"},
		{"/php2shell", "", "KEV-CVE-2026-109618"},
	}
	for _, c := range cases {
		r := httptest.NewRequest("GET", c.path, nil)
		r.URL.RawQuery = c.rawQuery
		v := g.Match(r)
		if v == nil {
			t.Errorf("%s?%s: no match, want %s", c.path, c.rawQuery, c.wantRule)
			continue
		}
		if v.Rule != c.wantRule {
			t.Errorf("%s?%s: rule=%s want %s", c.path, c.rawQuery, v.Rule, c.wantRule)
		}
	}
}

// Benign query that superficially resembles an attack must NOT trip.
func TestVirtualPatchNoFalsePositive(t *testing.T) {
	g := testGuard(t)
	benign := []struct{ path, query string }{
		{"/search", "q=union square new york"}, // "union" but not UNION SELECT
		{"/docs", "topic=passwd-reset"},        // contains "passwd" but not /etc/passwd
		{"/products", "id=42&sort=price"},      // ordinary
	}
	for _, c := range benign {
		r := httptest.NewRequest("GET", c.path, nil)
		r.URL.RawQuery = strings.ReplaceAll(c.query, " ", "%20")
		if v := g.Match(r); v != nil {
			t.Errorf("false positive on %s?%s: %+v", c.path, c.query, v)
		}
	}
}

// Disabled guard is a no-op.
func TestDisabledGuard(t *testing.T) {
	cfg := config.Default().Ingress
	cfg.Enabled = false
	g, _ := New(cfg)
	r := httptest.NewRequest("GET", "/php2shell", nil)
	if v := g.Inspect(r); v != nil {
		t.Errorf("disabled guard should not act: %+v", v)
	}
}

// Rules loaded from a file via the CRS/Coraza hook point.
func TestLoadRulesFile(t *testing.T) {
	rs := NewRuleSet()
	tmp := t.TempDir() + "/rules.txt"
	content := "# custom\nCUSTOM-1 | ua | (?i)evilbot | 403 | blocked UA\n"
	if err := os.WriteFile(tmp, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := rs.LoadFile(tmp); err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/", nil)
	r.Header.Set("User-Agent", "EvilBot/1.0")
	if v := rs.Match(r); v == nil || v.Rule != "CUSTOM-1" {
		t.Fatalf("custom rule not matched: %+v", v)
	}
}
