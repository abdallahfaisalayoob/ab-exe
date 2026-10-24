// Package ingress is Mirage's request-admission guard: a cheap first pass that
// rejects malformed or abusive request *shapes* before they reach the origin
// or the scorer. Its defaults are tuned to stop the PHP2Shell shape — huge
// urlencoded bodies with oversized field names — without breaking normal forms
// or uploads.
//
// The guard is fail-safe for availability: in monitor mode it only records
// violations (never rejects), and any internal error is handled by the proxy's
// fail-open wrapper. It also exposes a rule hook so OWASP CRS / Coraza rules
// and a CISA-KEV virtual-patch pack can run as an optional extra pass.
package ingress

import (
	"bytes"
	"io"
	"mime"
	"net/http"
	"strings"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// Violation describes why a request was flagged.
type Violation struct {
	Code   int    // HTTP status to return when enforcing
	Rule   string // short machine rule id
	Detail string // human-readable detail
}

// Guard performs ingress checks.
type Guard struct {
	cfg   config.Ingress
	rules *RuleSet
}

// New builds a guard. rules may be nil (virtual-patch pack + optional file are
// loaded here based on cfg).
func New(cfg config.Ingress) (*Guard, error) {
	rs := NewRuleSet()
	if cfg.VirtualPatch {
		rs.AddVirtualPatchPack()
	}
	if cfg.RulesFile != "" {
		if err := rs.LoadFile(cfg.RulesFile); err != nil {
			return nil, err
		}
	}
	return &Guard{cfg: cfg, rules: rs}, nil
}

// Match runs only the rule pass (virtual-patch pack + any loaded file rules)
// against the request. Exposed for testing and for callers that want the rule
// layer without the body-shape checks.
func (g *Guard) Match(r *http.Request) *Violation { return g.rules.Match(r) }

// Inspect checks a request. It returns a Violation (nil if clean) and, when a
// body was read for inspection, replaces r.Body with a re-readable copy so the
// origin still receives it intact.
func (g *Guard) Inspect(r *http.Request) *Violation {
	if !g.cfg.Enabled {
		return nil
	}

	// Header count.
	if n := headerCount(r); n > g.cfg.MaxHeaderCount {
		return &Violation{http.StatusBadRequest, "hdr.count",
			"too many headers"}
	}

	// Declared body size (cheap check before reading anything).
	if g.cfg.MaxBodyBytes > 0 && r.ContentLength > g.cfg.MaxBodyBytes {
		return &Violation{http.StatusRequestEntityTooLarge, "body.size",
			"content-length exceeds limit"}
	}

	// Rule pass over the request line + headers (virtual patches, CRS hook).
	if v := g.rules.Match(r); v != nil {
		return v
	}

	ct := r.Header.Get("Content-Type")
	mediaType, _, _ := mime.ParseMediaType(ct)

	switch {
	case mediaType == "application/x-www-form-urlencoded":
		return g.inspectURLEncoded(r)
	case strings.HasPrefix(mediaType, "multipart/"):
		return g.inspectMultipart(r)
	}
	return nil
}

// inspectURLEncoded reads the body (bounded), counts fields and checks field
// name lengths — the PHP2Shell shape — then restores the body for the origin.
func (g *Guard) inspectURLEncoded(r *http.Request) *Violation {
	body, v := g.readBody(r)
	if v != nil {
		return v
	}
	if body == nil {
		return nil
	}

	fields := 0
	s := body
	for len(s) > 0 {
		var pair []byte
		if i := bytes.IndexByte(s, '&'); i >= 0 {
			pair, s = s[:i], s[i+1:]
		} else {
			pair, s = s, nil
		}
		fields++
		if g.cfg.MaxFields > 0 && fields > g.cfg.MaxFields {
			return &Violation{http.StatusRequestEntityTooLarge, "form.fields",
				"too many form fields"}
		}
		name := pair
		if i := bytes.IndexByte(pair, '='); i >= 0 {
			name = pair[:i]
		}
		if g.cfg.MaxFieldNameLen > 0 && len(name) > g.cfg.MaxFieldNameLen {
			return &Violation{http.StatusRequestEntityTooLarge, "form.fieldname",
				"oversized form field name"}
		}
	}
	return nil
}

// inspectMultipart counts parts and checks field-name lengths with a bounded
// reader, then restores the body.
func (g *Guard) inspectMultipart(r *http.Request) *Violation {
	// For multipart we rely on Go's reader but bound total consumption.
	body, v := g.readBody(r)
	if v != nil {
		return v
	}
	if body == nil {
		return nil
	}
	// Re-parse from the buffered copy.
	r2 := r.Clone(r.Context())
	r2.Body = io.NopCloser(bytes.NewReader(body))
	if err := r2.ParseMultipartForm(g.cfg.MaxMultipartSize); err != nil {
		// A parse error on a declared-multipart body is itself suspicious, but
		// we fail open (let the origin decide) rather than reject on parse alone.
		return nil
	}
	fields := 0
	if r2.MultipartForm != nil {
		for name := range r2.MultipartForm.Value {
			fields++
			if g.cfg.MaxFieldNameLen > 0 && len(name) > g.cfg.MaxFieldNameLen {
				return &Violation{http.StatusRequestEntityTooLarge, "mp.fieldname",
					"oversized multipart field name"}
			}
		}
		for name, files := range r2.MultipartForm.File {
			fields++
			if len(name) > g.cfg.MaxFieldNameLen {
				return &Violation{http.StatusRequestEntityTooLarge, "mp.fieldname",
					"oversized multipart file field name"}
			}
			_ = files
		}
	}
	if g.cfg.MaxFields > 0 && fields > g.cfg.MaxFields {
		return &Violation{http.StatusRequestEntityTooLarge, "mp.fields",
			"too many multipart fields"}
	}
	return nil
}

// readBody reads up to MaxBodyBytes+1 and restores r.Body for the origin. It
// returns a Violation if the body exceeds the cap even when Content-Length lied.
func (g *Guard) readBody(r *http.Request) ([]byte, *Violation) {
	if r.Body == nil {
		return nil, nil
	}
	cap := g.cfg.MaxBodyBytes
	if cap <= 0 {
		cap = 10 << 20
	}
	limited := io.LimitReader(r.Body, cap+1)
	buf, err := io.ReadAll(limited)
	// Always restore whatever we read so the origin sees the full body (we also
	// drain the remainder below if the body was truncated by the limit).
	if err != nil {
		r.Body = io.NopCloser(bytes.NewReader(buf))
		return nil, nil // read error: fail open
	}
	if int64(len(buf)) > cap {
		// Body is larger than the cap despite Content-Length. Reject; do not
		// forward an oversized body.
		return nil, &Violation{http.StatusRequestEntityTooLarge, "body.size",
			"request body exceeds limit"}
	}
	r.Body = io.NopCloser(bytes.NewReader(buf))
	r.ContentLength = int64(len(buf))
	return buf, nil
}

func headerCount(r *http.Request) int {
	n := 0
	for _, v := range r.Header {
		n += len(v)
	}
	return n
}
