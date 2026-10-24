package allowlist

import (
	"crypto/ed25519"
	"encoding/base64"
	"fmt"
	"net/http"
	"strings"
)

// webBotAuth verifies Web Bot Auth signatures: RFC 9421 HTTP Message
// Signatures using Ed25519, as used to identify well-behaved automated agents.
// A request is trusted only if its Signature verifies, against a configured
// public key, over the exact components its Signature-Input names.
//
// Scope (honest): this verifies the signature itself against operator-supplied
// keys and checks the signer covered @authority. It does NOT yet fetch a live
// key directory, nor enforce `created`/`expires` freshness windows — see
// KNOWN_LIMITATIONS.md. It is real cryptographic verification, not a header
// presence check.
type webBotAuth struct {
	keys map[string]ed25519.PublicKey
}

func newWebBotAuth(raw map[string]string) (*webBotAuth, error) {
	w := &webBotAuth{keys: map[string]ed25519.PublicKey{}}
	for id, b64 := range raw {
		key, err := decodeKey(b64)
		if err != nil {
			return nil, fmt.Errorf("web_bot_auth_keys[%s]: %w", id, err)
		}
		w.keys[id] = key
	}
	return w, nil
}

func decodeKey(s string) (ed25519.PublicKey, error) {
	for _, dec := range []*base64.Encoding{base64.StdEncoding, base64.RawStdEncoding, base64.URLEncoding, base64.RawURLEncoding} {
		if b, err := dec.DecodeString(strings.TrimSpace(s)); err == nil && len(b) == ed25519.PublicKeySize {
			return ed25519.PublicKey(b), nil
		}
	}
	return nil, fmt.Errorf("not a base64 Ed25519 public key (want %d bytes)", ed25519.PublicKeySize)
}

// verify returns (true, keyid) when the request carries a valid signature.
func (w *webBotAuth) verify(r *http.Request) (bool, string) {
	sigInput := r.Header.Get("Signature-Input")
	sigHdr := r.Header.Get("Signature")
	if sigInput == "" || sigHdr == "" {
		return false, ""
	}
	label, components, paramsRaw, params, ok := parseSignatureInput(sigInput)
	if !ok {
		return false, ""
	}
	alg := strings.ToLower(trimQuotes(params["alg"]))
	if alg != "" && alg != "ed25519" {
		return false, "" // only Ed25519 supported
	}
	keyid := trimQuotes(params["keyid"])
	key, found := w.keys[keyid]
	if !found {
		return false, ""
	}
	sig, ok := parseSignatureValue(sigHdr, label)
	if !ok {
		return false, ""
	}
	base, ok := buildSignatureBase(r, components, paramsRaw)
	if !ok {
		return false, ""
	}
	if ed25519.Verify(key, []byte(base), sig) {
		return true, keyid
	}
	return false, ""
}

// parseSignatureInput parses `label=("c1" "c2");p=v;...` returning the label,
// the ordered component names (unquoted), the RAW inner-list+params string
// (used verbatim as the @signature-params value), and a param map.
func parseSignatureInput(s string) (label string, components []string, paramsRaw string, params map[string]string, ok bool) {
	s = strings.TrimSpace(s)
	// Take only the first signature definition if several are comma-separated
	// at the top level (Web Bot Auth uses one).
	eq := strings.IndexByte(s, '=')
	if eq < 0 {
		return
	}
	label = strings.TrimSpace(s[:eq])
	paramsRaw = strings.TrimSpace(s[eq+1:])
	if !strings.HasPrefix(paramsRaw, "(") {
		return
	}
	close := strings.IndexByte(paramsRaw, ')')
	if close < 0 {
		return
	}
	inner := paramsRaw[1:close]
	for _, tok := range strings.Fields(inner) {
		components = append(components, trimQuotes(tok))
	}
	params = map[string]string{}
	rest := paramsRaw[close+1:]
	for _, p := range strings.Split(rest, ";") {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if i := strings.IndexByte(p, '='); i >= 0 {
			params[strings.TrimSpace(p[:i])] = strings.TrimSpace(p[i+1:])
		} else {
			params[p] = ""
		}
	}
	ok = true
	return
}

// parseSignatureValue extracts the base64 signature bytes for the label from a
// `label=:base64:` structured field (handles multiple comma-separated entries).
func parseSignatureValue(s, label string) ([]byte, bool) {
	for _, part := range splitTopLevel(s, ',') {
		part = strings.TrimSpace(part)
		eq := strings.IndexByte(part, '=')
		if eq < 0 {
			continue
		}
		if strings.TrimSpace(part[:eq]) != label {
			continue
		}
		v := strings.TrimSpace(part[eq+1:])
		v = strings.TrimPrefix(v, ":")
		v = strings.TrimSuffix(v, ":")
		if b, err := base64.StdEncoding.DecodeString(v); err == nil {
			return b, true
		}
		if b, err := base64.RawStdEncoding.DecodeString(v); err == nil {
			return b, true
		}
		return nil, false
	}
	return nil, false
}

// buildSignatureBase constructs the RFC 9421 signature base for the covered
// components, ending with the @signature-params line whose value is the raw
// inner-list+params taken verbatim from Signature-Input.
func buildSignatureBase(r *http.Request, components []string, paramsRaw string) (string, bool) {
	var b strings.Builder
	for _, c := range components {
		name := strings.ToLower(c)
		val, ok := componentValue(r, name)
		if !ok {
			return "", false
		}
		fmt.Fprintf(&b, "\"%s\": %s\n", name, val)
	}
	fmt.Fprintf(&b, "\"@signature-params\": %s", paramsRaw)
	return b.String(), true
}

func componentValue(r *http.Request, name string) (string, bool) {
	switch name {
	case "@method":
		return strings.ToUpper(r.Method), true
	case "@authority":
		return strings.ToLower(r.Host), true
	case "@path":
		p := r.URL.EscapedPath()
		if p == "" {
			p = "/"
		}
		return p, true
	case "@query":
		return "?" + r.URL.RawQuery, true
	case "@scheme":
		return scheme(r), true
	case "@target-uri":
		return scheme(r) + "://" + r.Host + r.URL.RequestURI(), true
	default:
		if strings.HasPrefix(name, "@") {
			return "", false // unsupported derived component
		}
		vals := r.Header.Values(http.CanonicalHeaderKey(name))
		if len(vals) == 0 {
			return "", false
		}
		for i := range vals {
			vals[i] = strings.TrimSpace(vals[i])
		}
		return strings.Join(vals, ", "), true
	}
}

func scheme(r *http.Request) string {
	if xf := r.Header.Get("X-Forwarded-Proto"); xf != "" {
		return strings.ToLower(xf)
	}
	if r.TLS != nil {
		return "https"
	}
	if r.URL.Scheme != "" {
		return r.URL.Scheme
	}
	return "http"
}

func trimQuotes(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}

// splitTopLevel splits on sep but not inside quotes or colon-wrapped byte seq.
func splitTopLevel(s string, sep byte) []string {
	var out []string
	var cur strings.Builder
	inQuote, inColon := false, false
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch {
		case c == '"':
			inQuote = !inQuote
		case c == ':' && !inQuote:
			inColon = !inColon
		}
		if c == sep && !inQuote && !inColon {
			out = append(out, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteByte(c)
	}
	out = append(out, cur.String())
	return out
}
