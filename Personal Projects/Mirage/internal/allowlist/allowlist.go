// Package allowlist decides which clients are exempt from all enforcement, so
// legitimate traffic is never challenged, tarpitted or — above all — shadowed.
// This is one of Mirage's ship-safe defaults: health checks, operator IPs,
// reverse-DNS-verified search crawlers, and agents that present a valid
// Web Bot Auth (RFC 9421) signature are pinned to the monitor rung.
//
// Every check is fail-safe for the operator: a lookup error or a malformed
// signature simply means "not allowlisted" (the client is then scored
// normally), never a crash — and the whole thing runs inside the proxy's
// fail-open guard regardless.
package allowlist

import (
	"context"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// sysResolver adapts *net.Resolver (context-taking) to the simpler Resolver
// interface, with a bounded timeout so a slow DNS server can't stall requests.
type sysResolver struct{ r *net.Resolver }

func (s sysResolver) LookupAddr(name string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.r.LookupAddr(ctx, name)
}

func (s sysResolver) LookupHost(host string) ([]string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()
	return s.r.LookupHost(ctx, host)
}

// Resolver is the subset of net.Resolver the crawler check needs. It is an
// interface so tests can supply deterministic DNS without touching the network.
type Resolver interface {
	LookupAddr(name string) ([]string, error)
	LookupHost(host string) ([]string, error)
}

// Allowlist evaluates exemption for a request.
type Allowlist struct {
	ips      []net.IP
	cidrs    []*net.IPNet
	paths    []string
	crawlers bool
	suffixes []string
	botAuth  *webBotAuth
	resolver Resolver
	ptrCache *ptrCache
}

// defaultCrawlerSuffixes are the reverse-DNS suffixes of well-known good
// crawlers, forward-confirmed before trust. Operators can override via config.
var defaultCrawlerSuffixes = []string{
	".googlebot.com", ".google.com", ".search.msn.com", ".crawl.yahoo.net",
	".applebot.apple.com", ".duckduckgo.com", ".crawl.baidu.com",
}

// New builds an Allowlist from config. resolver may be nil (uses the system
// resolver). It returns an error only for unparseable static config (bad CIDR
// or key); runtime lookups never error out of Check.
func New(cfg config.Allowlist, resolver Resolver) (*Allowlist, error) {
	a := &Allowlist{
		paths:    append([]string(nil), cfg.Paths...),
		crawlers: cfg.VerifyCrawlers,
		resolver: resolver,
		ptrCache: newPTRCache(2048),
	}
	if a.resolver == nil {
		a.resolver = sysResolver{net.DefaultResolver}
	}
	for _, s := range cfg.IPs {
		s = strings.TrimSpace(s)
		if s == "" {
			continue
		}
		if strings.Contains(s, "/") {
			_, nw, err := net.ParseCIDR(s)
			if err != nil {
				return nil, err
			}
			a.cidrs = append(a.cidrs, nw)
		} else if ip := net.ParseIP(s); ip != nil {
			a.ips = append(a.ips, ip)
		}
	}
	a.suffixes = cfg.CrawlerSuffixes
	if len(a.suffixes) == 0 {
		a.suffixes = defaultCrawlerSuffixes
	}
	if cfg.WebBotAuth {
		wba, err := newWebBotAuth(cfg.WebBotAuthKeys)
		if err != nil {
			return nil, err
		}
		a.botAuth = wba
	}
	return a, nil
}

// Check reports whether the request is allowlisted and a short reason. ip is
// the resolved client IP (as the session layer computed it).
func (a *Allowlist) Check(r *http.Request, ip string) (bool, string) {
	// 1) Path prefixes (health checks) — cheapest, no network.
	for _, p := range a.paths {
		if p != "" && strings.HasPrefix(r.URL.Path, p) {
			return true, "allowlisted path " + p
		}
	}

	// 2) Static IPs / CIDRs.
	if pip := net.ParseIP(ip); pip != nil {
		for _, one := range a.ips {
			if one.Equal(pip) {
				return true, "allowlisted ip"
			}
		}
		for _, nw := range a.cidrs {
			if nw.Contains(pip) {
				return true, "allowlisted cidr " + nw.String()
			}
		}
	}

	// 3) Web Bot Auth (RFC 9421 signature) — a verifiable, portable identity
	// that doesn't depend on IP or DNS.
	if a.botAuth != nil {
		if ok, keyid := a.botAuth.verify(r); ok {
			return true, "web-bot-auth keyid=" + keyid
		}
	}

	// 4) Reverse-DNS-verified crawler (PTR + forward-confirm).
	if a.crawlers && ip != "" {
		if host, ok := a.verifiedCrawler(ip); ok {
			return true, "verified crawler " + host
		}
	}

	return false, ""
}

// verifiedCrawler does the standard two-step check: PTR of the IP must end with
// a trusted suffix AND a forward lookup of that hostname must resolve back to
// the same IP (so a forged PTR can't grant trust). Results are cached.
func (a *Allowlist) verifiedCrawler(ip string) (string, bool) {
	if host, ok, cached := a.ptrCache.get(ip); cached {
		return host, ok
	}
	host, ok := a.resolveVerified(ip)
	a.ptrCache.put(ip, host, ok)
	return host, ok
}

func (a *Allowlist) resolveVerified(ip string) (string, bool) {
	names, err := a.resolver.LookupAddr(ip)
	if err != nil || len(names) == 0 {
		return "", false
	}
	for _, name := range names {
		h := strings.TrimSuffix(strings.ToLower(name), ".")
		if !a.suffixMatch(h) {
			continue
		}
		// Forward-confirm: the hostname must resolve back to this IP.
		addrs, err := a.resolver.LookupHost(h)
		if err != nil {
			continue
		}
		for _, addr := range addrs {
			if ipEqual(addr, ip) {
				return h, true
			}
		}
	}
	return "", false
}

func (a *Allowlist) suffixMatch(host string) bool {
	for _, suf := range a.suffixes {
		s := strings.ToLower(suf)
		if strings.HasSuffix(host, s) || host == strings.TrimPrefix(s, ".") {
			return true
		}
	}
	return false
}

func ipEqual(a, b string) bool {
	pa, pb := net.ParseIP(a), net.ParseIP(b)
	if pa == nil || pb == nil {
		return a == b
	}
	return pa.Equal(pb)
}
