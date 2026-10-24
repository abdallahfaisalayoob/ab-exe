package allowlist

import (
	"net/http/httptest"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// fakeResolver gives deterministic PTR/forward answers for crawler tests.
type fakeResolver struct {
	ptr     map[string][]string // ip -> hostnames
	forward map[string][]string // host -> ips
}

func (f fakeResolver) LookupAddr(ip string) ([]string, error) { return f.ptr[ip], nil }
func (f fakeResolver) LookupHost(h string) ([]string, error)  { return f.forward[h], nil }

func TestPathAndIP(t *testing.T) {
	cfg := config.Allowlist{
		Paths: []string{"/healthz"},
		IPs:   []string{"10.0.0.5", "192.168.0.0/16"},
	}
	a, err := New(cfg, fakeResolver{})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest("GET", "/healthz", nil)
	if ok, _ := a.Check(r, "1.2.3.4"); !ok {
		t.Error("health path should be allowlisted")
	}
	r2 := httptest.NewRequest("GET", "/x", nil)
	if ok, _ := a.Check(r2, "10.0.0.5"); !ok {
		t.Error("exact IP should be allowlisted")
	}
	if ok, _ := a.Check(r2, "192.168.42.7"); !ok {
		t.Error("CIDR member should be allowlisted")
	}
	if ok, _ := a.Check(r2, "8.8.8.8"); ok {
		t.Error("unlisted IP must NOT be allowlisted")
	}
}

func TestVerifiedCrawler(t *testing.T) {
	cfg := config.Allowlist{VerifyCrawlers: true}
	fr := fakeResolver{
		ptr: map[string][]string{
			"66.249.66.1": {"crawl-66-249-66-1.googlebot.com."},
			"13.66.139.0": {"evil.attacker.com."},   // wrong suffix
			"1.2.3.4":     {"spoof.googlebot.com."}, // right suffix, forward won't confirm
		},
		forward: map[string][]string{
			"crawl-66-249-66-1.googlebot.com": {"66.249.66.1"},
			"spoof.googlebot.com":             {"9.9.9.9"}, // doesn't match 1.2.3.4
		},
	}
	a, _ := New(cfg, fr)
	r := httptest.NewRequest("GET", "/", nil)

	if ok, _ := a.Check(r, "66.249.66.1"); !ok {
		t.Error("real Googlebot (PTR + forward-confirm) should be allowlisted")
	}
	if ok, _ := a.Check(r, "13.66.139.0"); ok {
		t.Error("non-crawler suffix must NOT be allowlisted")
	}
	if ok, _ := a.Check(r, "1.2.3.4"); ok {
		t.Error("forged PTR without forward-confirmation must NOT be allowlisted")
	}
}

func TestCrawlerDisabled(t *testing.T) {
	a, _ := New(config.Allowlist{VerifyCrawlers: false}, fakeResolver{
		ptr:     map[string][]string{"66.249.66.1": {"x.googlebot.com."}},
		forward: map[string][]string{"x.googlebot.com": {"66.249.66.1"}},
	})
	if ok, _ := a.Check(httptest.NewRequest("GET", "/", nil), "66.249.66.1"); ok {
		t.Error("crawler verification disabled: must not allowlist")
	}
}
