// Package fingerprint derives a coarse client fingerprint from request
// metadata and detects inconsistencies — the classic "User-Agent says Chrome
// but the headers look like Python/curl" tell.
package fingerprint

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
)

// Print is a coarse, stable-ish fingerprint of a client.
type Print struct {
	// ID is a short hash over header names/order + UA family + TLS hint.
	ID string
	// UAFamily is the browser/tool family claimed by User-Agent.
	UAFamily string
	// HeaderShape is the lowercased, ordered list of header names joined by ','.
	HeaderShape string
	// TLSHint is a hint at the real client stack, if TLS terminated here.
	TLSHint string
	// Inconsistent is true when the claimed UA family contradicts the header
	// shape or TLS hint (e.g. claims Chrome but has no Accept-Language and the
	// header order matches a scripting library).
	Inconsistent bool
	// Reasons explains an Inconsistent verdict.
	Reasons []string
}

// browserUAMarkers identify common real-browser User-Agents.
var browserUAMarkers = []string{"mozilla", "chrome", "safari", "firefox", "edg/", "gecko"}

// toolUAMarkers identify obvious automation User-Agents.
var toolUAMarkers = []string{
	"python-requests", "python-urllib", "aiohttp", "httpx", "curl", "wget",
	"go-http-client", "okhttp", "java/", "libwww", "scrapy", "node-fetch",
	"axios", "postman", "insomnia", "httpie",
}

// From builds a Print from a request. tlsHint may be "" when TLS is not
// terminated at Mirage; when present it is a lightweight signature of the
// TLS ClientHello (see proxy for how it is captured).
func From(r *http.Request, tlsHint string) Print {
	ua := strings.ToLower(r.Header.Get("User-Agent"))
	shape := headerShape(r)
	p := Print{
		UAFamily:    uaFamily(ua),
		HeaderShape: shape,
		TLSHint:     tlsHint,
	}

	claimsBrowser := containsAny(ua, browserUAMarkers)
	isToolUA := containsAny(ua, toolUAMarkers)

	// Hard tell: UA claims a browser but names a tool too, or TLS/header shape
	// contradicts the browser claim.
	if claimsBrowser && isToolUA {
		p.Inconsistent = true
		p.Reasons = append(p.Reasons, "User-Agent mixes browser and automation markers")
	}
	if claimsBrowser {
		// Real browsers always send Accept and usually Accept-Language +
		// Accept-Encoding. Their absence with a browser UA is suspicious.
		if r.Header.Get("Accept") == "" {
			p.Inconsistent = true
			p.Reasons = append(p.Reasons, "browser UA but no Accept header")
		}
		if r.Header.Get("Accept-Language") == "" && r.Header.Get("Accept-Encoding") == "" {
			p.Inconsistent = true
			p.Reasons = append(p.Reasons, "browser UA but no Accept-Language/Encoding")
		}
		if tlsHint != "" && strings.HasPrefix(tlsHint, "tool:") {
			p.Inconsistent = true
			p.Reasons = append(p.Reasons, "browser UA but TLS fingerprint looks like a library")
		}
	}

	sum := sha256.Sum256([]byte(p.UAFamily + "|" + shape + "|" + tlsHint))
	p.ID = hex.EncodeToString(sum[:8])
	return p
}

func uaFamily(ua string) string {
	switch {
	case ua == "":
		return "none"
	case containsAny(ua, toolUAMarkers):
		for _, m := range toolUAMarkers {
			if strings.Contains(ua, m) {
				return strings.TrimSuffix(strings.TrimSuffix(m, "/"), "-http-client")
			}
		}
	case strings.Contains(ua, "edg/"):
		return "edge"
	case strings.Contains(ua, "chrome"):
		return "chrome"
	case strings.Contains(ua, "firefox"):
		return "firefox"
	case strings.Contains(ua, "safari"):
		return "safari"
	}
	return "other"
}

// headerShape returns the lowercased header names in the order they were sent.
// Go's http server preserves order via Header map only partially, so we derive
// order from the canonical header slice when available; otherwise sorted names.
func headerShape(r *http.Request) string {
	names := make([]string, 0, len(r.Header))
	for k := range r.Header {
		names = append(names, strings.ToLower(k))
	}
	// Stable but order-insensitive is acceptable here: the *set* of headers is
	// itself a strong signal, and Go does not expose true wire order anyway.
	// We sort for stability so the same client hashes consistently.
	insertionSort(names)
	return strings.Join(names, ",")
}

func insertionSort(s []string) {
	for i := 1; i < len(s); i++ {
		for j := i; j > 0 && s[j] < s[j-1]; j-- {
			s[j], s[j-1] = s[j-1], s[j]
		}
	}
}

func containsAny(s string, subs []string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
