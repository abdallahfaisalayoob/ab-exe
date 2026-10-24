package shadow

import (
	"regexp"
	"strings"
)

var (
	reEmail    = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)
	reUUID     = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	reDateTime = regexp.MustCompile(`^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2})`)
	reURL      = regexp.MustCompile(`^https?://`)
)

// secretFieldHints name fields whose VALUE should be a tracked honeytoken
// rather than ordinary fake data. This is where lures get planted.
var secretFieldHints = []string{
	"key", "token", "secret", "password", "passwd", "pwd", "apikey",
	"api_key", "access", "credential", "auth", "private", "session",
}

// inferStringKind classifies a string value using its format and field name.
func inferStringKind(field, val string) kind {
	f := strings.ToLower(field)
	for _, h := range secretFieldHints {
		if strings.Contains(f, h) {
			return kSecret
		}
	}
	switch {
	case reEmail.MatchString(val):
		return kEmail
	case reUUID.MatchString(val):
		return kUUID
	case reDateTime.MatchString(val):
		return kDateTime
	case reURL.MatchString(val):
		return kURL
	}
	if f == "name" || strings.HasSuffix(f, "_name") || f == "username" || f == "user" || f == "fullname" {
		return kName
	}
	return kString
}

func isJSONType(ct string) bool {
	ct = strings.ToLower(ct)
	return strings.Contains(ct, "application/json") || strings.Contains(ct, "+json")
}

func isHTMLType(ct string) bool {
	return strings.Contains(strings.ToLower(ct), "text/html")
}
