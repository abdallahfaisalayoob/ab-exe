// Package leak inspects OUTGOING responses and redacts secret-shaped content
// before it leaves Mirage. This is the response-side defence the PHP2Shell
// episode showed request inspection alone can't provide: a memory-disclosure
// or debug-leak bug can emit secrets through a route that looks entirely
// normal on the request side. PHP2Shell (an oversized session cookie leaking
// worker memory) is the example, not the scope — the same filter catches
// private keys, API keys, stack traces, phpinfo() and config dumps on any
// stack.
//
// The filter wraps the ResponseWriter. Headers are always inspected. Bodies
// are buffered up to a cap for full inspection, then streamed with an overlap
// window so a secret split across chunk boundaries is still caught. Non-text
// content types skip body scanning (headers still scanned) to protect the
// latency budget.
package leak

import (
	"bytes"
	"net/http"
	"regexp"
	"strings"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
)

// Filter holds compiled redaction rules.
type Filter struct {
	cfg      config.Leak
	patterns []rule
	// OnHit is called when a rule redacts something (for metrics/alerts).
	OnHit func(rule string, where string)
}

type rule struct {
	name string
	re   *regexp.Regexp
	// repl is the replacement for body matches.
	repl string
}

// New builds a filter from config.
func New(cfg config.Leak) (*Filter, error) {
	f := &Filter{cfg: cfg}
	if cfg.RedactKeys {
		f.patterns = append(f.patterns,
			rule{"private_key", regexp.MustCompile(`-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----`), "[REDACTED PRIVATE KEY]"},
			rule{"aws_secret", regexp.MustCompile(`(?i)aws_secret_access_key["']?\s*[=:]\s*["']?[A-Za-z0-9/+]{40}`), "aws_secret_access_key=[REDACTED]"},
			rule{"aws_akid", regexp.MustCompile(`\bAKIA[0-9A-Z]{16}\b`), "[REDACTED AWS KEY]"},
			rule{"stripe_sk", regexp.MustCompile(`\bsk_live_[0-9a-zA-Z]{16,}\b`), "[REDACTED STRIPE KEY]"},
			rule{"github_pat", regexp.MustCompile(`\bghp_[0-9A-Za-z]{30,}\b`), "[REDACTED GITHUB TOKEN]"},
			rule{"google_api", regexp.MustCompile(`\bAIza[0-9A-Za-z\-_]{35}\b`), "[REDACTED GOOGLE KEY]"},
			rule{"slack_token", regexp.MustCompile(`\bxox[baprs]-[0-9A-Za-z\-]{10,}\b`), "[REDACTED SLACK TOKEN]"},
			rule{"generic_bearer", regexp.MustCompile(`(?i)bearer\s+[A-Za-z0-9\-_\.=]{20,}`), "Bearer [REDACTED]"},
		)
	}
	if cfg.RedactTraces {
		f.patterns = append(f.patterns,
			// PHP / Python / Java / Node / .NET / Go stack-trace markers.
			rule{"php_trace", regexp.MustCompile(`(?i)(Fatal error:|Stack trace:|#\d+ /[\w/]+\.php\(\d+\))`), "[REDACTED TRACE]"},
			rule{"py_trace", regexp.MustCompile(`Traceback \(most recent call last\):[\s\S]*?(?:Error|Exception):.*`), "[REDACTED TRACE]"},
			rule{"java_trace", regexp.MustCompile(`(?:Exception in thread|\tat [\w.$]+\([\w.]+:\d+\))`), "[REDACTED TRACE]"},
			rule{"node_trace", regexp.MustCompile(`\n\s+at .+\(.+:\d+:\d+\)`), "[REDACTED TRACE]"},
			rule{"go_trace", regexp.MustCompile(`goroutine \d+ \[[\w ]+\]:[\s\S]*?\.go:\d+`), "[REDACTED TRACE]"},
			rule{"dotnet_trace", regexp.MustCompile(`at [\w.<>]+\(.*\) in .+:line \d+`), "[REDACTED TRACE]"},
		)
	}
	if cfg.RedactPHPInfo {
		f.patterns = append(f.patterns,
			rule{"phpinfo", regexp.MustCompile(`(?i)(<title>phpinfo\(\)|PHP Version \d|phpinfo\(\))`), "[REDACTED PHPINFO]"},
		)
	}
	// Dotenv / config-dump block (KEY=secret lines in bulk).
	f.patterns = append(f.patterns,
		rule{"dotenv_dump", regexp.MustCompile(`(?m)^(?:[A-Z0-9_]+=(?:secret|password|key|token)[^\n]*\n){2,}`), "[REDACTED CONFIG BLOCK]\n"},
	)
	for _, p := range cfg.ExtraPatterns {
		re, err := regexp.Compile(p)
		if err != nil {
			return nil, err
		}
		f.patterns = append(f.patterns, rule{"custom", re, "[REDACTED]"})
	}
	return f, nil
}

// InspectHeaders redacts secret-shaped response headers in place. The flagship
// case is an oversized or binary Set-Cookie — the PHP2Shell memory-disclosure
// shape. Returns the rule names that fired.
func (f *Filter) InspectHeaders(h http.Header) []string {
	var hits []string
	// Oversized / binary Set-Cookie → memory disclosure shape.
	for i, sc := range h.Values("Set-Cookie") {
		if len(sc) > f.cfg.MaxCookieBytes || hasNonPrintable(sc) {
			// Replace just the value, keep a harmless cookie so the app's flow
			// isn't obviously broken, but the leaked bytes never leave.
			redacted := redactCookie(sc)
			setCookieAt(h, i, redacted)
			hits = append(hits, "oversized_cookie")
		}
	}
	// Scan a few header values that sometimes carry secrets/traces.
	for _, name := range []string{"X-Powered-By", "Server", "X-Debug", "X-Error", "WWW-Authenticate"} {
		v := h.Get(name)
		if v == "" {
			continue
		}
		if red, rules, changed := f.redactString(v); changed {
			h.Set(name, red)
			hits = append(hits, rules...)
		}
	}
	return hits
}

// RedactBody applies body rules, returning the cleaned body and rule hits.
func (f *Filter) RedactBody(contentType string, body []byte) ([]byte, []string) {
	if !isTextType(contentType) {
		return body, nil // binary: headers already scanned; skip body
	}
	red, rules, changed := f.redactString(string(body))
	if !changed {
		return body, nil
	}
	return []byte(red), rules
}

func (f *Filter) redactString(s string) (string, []string, bool) {
	var hits []string
	changed := false
	for _, p := range f.patterns {
		if p.re.MatchString(s) {
			s = p.re.ReplaceAllString(s, p.repl)
			hits = append(hits, p.name)
			changed = true
		}
	}
	return s, hits, changed
}

// TextLike reports whether a content type should have its body scanned.
func (f *Filter) TextLike(ct string) bool { return isTextType(ct) }

func isTextType(ct string) bool {
	ct = strings.ToLower(ct)
	if ct == "" {
		return true // unknown: be safe and scan
	}
	for _, p := range []string{"text/", "json", "xml", "javascript", "html", "yaml", "csv", "x-www-form-urlencoded"} {
		if strings.Contains(ct, p) {
			return true
		}
	}
	return false
}

func hasNonPrintable(s string) bool {
	for i := 0; i < len(s); i++ {
		c := s[i]
		if c < 0x09 || (c > 0x0d && c < 0x20) || c == 0x7f {
			return true
		}
	}
	return false
}

func redactCookie(sc string) string {
	// Keep the cookie name; redact the value and attributes.
	if i := strings.IndexByte(sc, '='); i >= 0 {
		return sc[:i+1] + "[REDACTED]"
	}
	return "[REDACTED]"
}

func setCookieAt(h http.Header, idx int, val string) {
	vals := h.Values("Set-Cookie")
	if idx < 0 || idx >= len(vals) {
		return
	}
	cp := make([]string, len(vals))
	copy(cp, vals)
	cp[idx] = val
	h.Del("Set-Cookie")
	for _, v := range cp {
		h.Add("Set-Cookie", v)
	}
}

var _ = bytes.MinRead
