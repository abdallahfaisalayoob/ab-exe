// Package shadow is Mirage's deception engine. For a high-confidence hostile
// agent session it serves a per-session fake of the real app: the same status
// codes, headers and response structure, but fabricated data seeded with
// tracked honeytokens. The fake is DETERMINISTIC within a session — the same
// fake user id returns the same fake record every time — so an agent probing
// for inconsistency finds none. A detectable fake is worse than none.
package shadow

import (
	"encoding/json"
	"sync"

	"github.com/abdallahfaisalayoob/mirage/internal/pathtmpl"
)

// kind classifies an inferred value so generation can fabricate a plausible
// replacement of the same type/format.
type kind int

const (
	kNull kind = iota
	kBool
	kInt
	kFloat
	kString // generic
	kEmail
	kUUID
	kDateTime
	kURL
	kName
	kSecret // looks like a key/token/password → honeytoken slot
	kObject
	kArray
)

// node is an inferred JSON schema node.
type node struct {
	Kind   kind
	Fields map[string]*node // for objects
	Keys   []string         // stable field order
	Elem   *node            // for arrays
	// FieldName is the key this node sits under (used for format/secret hints).
	FieldName string
}

// Schema is the learned response shape for one route template.
type Schema struct {
	Template    string
	Status      int
	ContentType string
	HeaderNames []string
	IsJSON      bool
	Root        *node
	// HTMLBody is a cached real HTML body (data-looking tokens get swapped at
	// generation time). Only populated for HTML routes.
	HTMLBody []byte
	samples  int
}

// Store holds learned schemas keyed by route template.
type Store struct {
	mu  sync.RWMutex
	byT map[string]*Schema
	// maxSamples caps how many observations refine a schema (cheap stability).
	maxSamples int
}

// NewStore builds a shape store.
func NewStore() *Store {
	return &Store{byT: make(map[string]*Schema), maxSamples: 8}
}

// Get returns the schema for a template, if learned.
func (s *Store) Get(template string) (*Schema, bool) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	sc, ok := s.byT[template]
	return sc, ok
}

// Count returns the number of learned templates.
func (s *Store) Count() int {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return len(s.byT)
}

// Observe learns from a real response. Called on the response path for
// non-shadowed (real) traffic, with a bounded body sample.
func (s *Store) Observe(template string, status int, contentType string, headerNames []string, body []byte) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc := s.byT[template]
	if sc == nil {
		sc = &Schema{Template: template, Status: status, ContentType: contentType, HeaderNames: headerNames}
		s.byT[template] = sc
	}
	if sc.samples >= s.maxSamples {
		return
	}
	sc.samples++

	if isJSONType(contentType) {
		var v any
		if err := json.Unmarshal(body, &v); err == nil {
			sc.IsJSON = true
			n := inferNode("", v)
			sc.Root = mergeNode(sc.Root, n)
		}
		return
	}
	if isHTMLType(contentType) && sc.HTMLBody == nil {
		// Cache one real HTML body; generation swaps data-looking values.
		b := make([]byte, len(body))
		copy(b, body)
		sc.HTMLBody = b
	}
}

// SeedTemplate registers a template known to exist (e.g. from an OpenAPI spec
// or a planted admin endpoint) even before it's observed, so the shadow can
// serve it consistently.
func (s *Store) SeedTemplate(template string, sc *Schema) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sc.Template = template
	s.byT[template] = sc
}

// NormaliseTemplate exposes path normalisation for callers.
func NormaliseTemplate(path string) string { return pathtmpl.Normalise(path) }

// inferNode infers a schema node from a decoded JSON value.
func inferNode(field string, v any) *node {
	switch x := v.(type) {
	case nil:
		return &node{Kind: kNull, FieldName: field}
	case bool:
		return &node{Kind: kBool, FieldName: field}
	case float64:
		if x == float64(int64(x)) {
			return &node{Kind: kInt, FieldName: field}
		}
		return &node{Kind: kFloat, FieldName: field}
	case string:
		return &node{Kind: inferStringKind(field, x), FieldName: field}
	case []any:
		var elem *node
		if len(x) > 0 {
			elem = inferNode(field, x[0])
		} else {
			elem = &node{Kind: kString, FieldName: field}
		}
		return &node{Kind: kArray, Elem: elem, FieldName: field}
	case map[string]any:
		n := &node{Kind: kObject, Fields: map[string]*node{}, FieldName: field}
		for k, val := range x {
			n.Fields[k] = inferNode(k, val)
		}
		n.Keys = sortedKeys(x)
		return n
	}
	return &node{Kind: kString, FieldName: field}
}

// mergeNode combines a new observation into an existing node (union of object
// keys), keeping the schema stable across samples.
func mergeNode(a, b *node) *node {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	if a.Kind == kObject && b.Kind == kObject {
		for k, bn := range b.Fields {
			if an, ok := a.Fields[k]; ok {
				a.Fields[k] = mergeNode(an, bn)
			} else {
				a.Fields[k] = bn
				a.Keys = append(a.Keys, k)
			}
		}
		return a
	}
	if a.Kind == kArray && b.Kind == kArray {
		a.Elem = mergeNode(a.Elem, b.Elem)
		return a
	}
	return a
}

func sortedKeys(m map[string]any) []string {
	ks := make([]string, 0, len(m))
	for k := range m {
		ks = append(ks, k)
	}
	// insertion sort for stable, dependency-free ordering
	for i := 1; i < len(ks); i++ {
		for j := i; j > 0 && ks[j] < ks[j-1]; j-- {
			ks[j], ks[j-1] = ks[j-1], ks[j]
		}
	}
	return ks
}
