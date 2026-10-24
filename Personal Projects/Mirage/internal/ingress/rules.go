package ingress

import (
	"bufio"
	"net/http"
	"os"
	"regexp"
	"strconv"
	"strings"
)

// RuleSet is Mirage's optional rule-matching pass. It serves two purposes:
//
//  1. A small built-in CISA-KEV virtual-patch pack: shape rules keyed to CVE
//     IDs that block the obvious exploit *shape* as a cheap first pass while
//     you patch. These are shape heuristics, NOT exploit code.
//  2. A hook point for OWASP CRS / Coraza-compatible rules. The built-in
//     loader parses a simple line format; a Coraza adapter can implement the
//     same Match contract and be swapped in without touching the pipeline.
//
// Rule matching is deliberately conservative: it targets request-line and
// header shapes, not benign content, so false positives on normal traffic
// are rare. Everything it does is also gated by enforce mode at the call site.
type RuleSet struct {
	rules []rule
}

type rule struct {
	id     string
	target targetKind
	re     *regexp.Regexp
	code   int
	detail string
}

type targetKind int

const (
	targetPath targetKind = iota
	targetQuery
	targetURI // path + query
	targetUA
	targetHeaderNames
)

// NewRuleSet returns an empty rule set.
func NewRuleSet() *RuleSet { return &RuleSet{} }

// Match runs every rule against the request, returning the first Violation.
func (rs *RuleSet) Match(r *http.Request) *Violation {
	if len(rs.rules) == 0 {
		return nil
	}
	path := r.URL.Path
	query := r.URL.RawQuery
	uri := r.URL.RequestURI()
	ua := r.Header.Get("User-Agent")
	for i := range rs.rules {
		ru := &rs.rules[i]
		var subject string
		switch ru.target {
		case targetPath:
			subject = path
		case targetQuery:
			subject = query
		case targetURI:
			subject = uri
		case targetUA:
			subject = ua
		case targetHeaderNames:
			subject = headerNameList(r)
		}
		if ru.re.MatchString(subject) {
			return &Violation{Code: ru.code, Rule: ru.id, Detail: ru.detail}
		}
	}
	return nil
}

// AddVirtualPatchPack loads the built-in CISA-KEV shape rules.
//
// NOTE: these are illustrative shape heuristics for well-known exploit
// *patterns*. They are a cheap first pass, explicitly NOT a replacement for
// patching (see SECURITY.md). CVE IDs are attached so operators can map a hit
// back to the KEV catalog.
func (rs *RuleSet) AddVirtualPatchPack() {
	add := func(id string, t targetKind, pat string, code int, detail string) {
		rs.rules = append(rs.rules, rule{
			id: id, target: t, re: regexp.MustCompile(pat), code: code, detail: detail,
		})
	}

	// PHP2Shell (the scenario this product was designed around). The exploit
	// shape is an oversized urlencoded field; the field-length guard in
	// ingress.go is the primary defence. This rule catches the known marker
	// path/parameter so a hit is attributable to the CVE.
	add("KEV-CVE-2026-109618", targetURI,
		`(?i)(/php2shell|[?&]__p2s_payload=)`, http.StatusForbidden,
		"PHP2Shell exploit-shape marker (CVE-2026-109618)")
	add("KEV-CVE-2026-109619", targetQuery,
		`(?i)(^|&)(cmd|exec|__p2s)=.{0,0}%00`, http.StatusForbidden,
		"PHP2Shell memory-disclosure trigger shape (CVE-2026-109619)")

	// Generic high-signal shapes commonly seen in KEV mass-exploitation.
	add("VP-path-traversal", targetURI,
		`(?:\.\./){3,}|/etc/passwd|\.\.%2f|%2e%2e%2f`, http.StatusForbidden,
		"path traversal shape")
	add("VP-null-byte", targetURI,
		`%00`, http.StatusBadRequest,
		"null byte in URI")
	add("VP-shell-injection", targetQuery,
		`(?i)(;|%3b|\$\(|%24%28|\x60)\s*(id|whoami|uname|cat\s|wget\s|curl\s)`,
		http.StatusForbidden, "command-injection shape in query")
	add("VP-sqli-union", targetQuery,
		`(?i)union(\s|%20|/\*.*\*/)+select`, http.StatusForbidden,
		"SQL injection UNION SELECT shape")
	add("VP-log4shell", targetURI,
		`(?i)\$\{jndi:(ldap|rmi|dns)`, http.StatusForbidden,
		"JNDI lookup shape (Log4Shell-style)")
	add("VP-ssti", targetQuery,
		`(?:\{\{.*\}\}|\$\{.*\}).{0,40}(?i)(system|runtime|exec|class)`,
		http.StatusForbidden, "server-side template injection shape")
}

// LoadFile loads additional rules from a simple text format so operators can
// bring CRS-style rules without compiling Mirage. This is the documented hook
// point; a full Coraza adapter would implement Match() instead.
//
// Format (one rule per line, '#' comments allowed):
//
//	ID | target | regex | code | detail
//
// target ∈ {path, query, uri, ua, headers}
func (rs *RuleSet) LoadFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := strings.TrimSpace(sc.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, "|", 5)
		if len(parts) < 4 {
			continue
		}
		for i := range parts {
			parts[i] = strings.TrimSpace(parts[i])
		}
		re, err := regexp.Compile(parts[2])
		if err != nil {
			return err
		}
		code, _ := strconv.Atoi(parts[3])
		if code == 0 {
			code = http.StatusForbidden
		}
		detail := ""
		if len(parts) == 5 {
			detail = parts[4]
		}
		rs.rules = append(rs.rules, rule{
			id: parts[0], target: parseTarget(parts[1]), re: re, code: code, detail: detail,
		})
	}
	return sc.Err()
}

func parseTarget(s string) targetKind {
	switch strings.ToLower(s) {
	case "query":
		return targetQuery
	case "uri":
		return targetURI
	case "ua":
		return targetUA
	case "headers":
		return targetHeaderNames
	default:
		return targetPath
	}
}

func headerNameList(r *http.Request) string {
	var b strings.Builder
	for k := range r.Header {
		b.WriteString(strings.ToLower(k))
		b.WriteByte(',')
	}
	return b.String()
}
