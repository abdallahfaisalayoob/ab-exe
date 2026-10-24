// Package pathtmpl normalises concrete URL paths into route templates so that
// /users/42 and /users/99 collapse to /users/{id}. Templates are the unit of
// enumeration-breadth and shape-learning throughout Mirage.
package pathtmpl

import (
	"regexp"
	"strings"
)

var (
	reNumeric = regexp.MustCompile(`^\d+$`)
	reUUID    = regexp.MustCompile(`^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$`)
	reHex     = regexp.MustCompile(`^[0-9a-fA-F]{16,}$`)
	reLongB64 = regexp.MustCompile(`^[A-Za-z0-9_\-]{20,}={0,2}$`)
)

// Normalise returns the template form of a path.
func Normalise(path string) string {
	if path == "" || path == "/" {
		return "/"
	}
	segs := strings.Split(strings.Trim(path, "/"), "/")
	for i, s := range segs {
		switch {
		case reNumeric.MatchString(s):
			segs[i] = "{id}"
		case reUUID.MatchString(s):
			segs[i] = "{uuid}"
		case reHex.MatchString(s):
			segs[i] = "{hex}"
		case reLongB64.MatchString(s):
			segs[i] = "{token}"
		}
	}
	return "/" + strings.Join(segs, "/")
}
