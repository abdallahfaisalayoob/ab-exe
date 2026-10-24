package shadow

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/rand"

	"github.com/abdallahfaisalayoob/mirage/internal/honeytoken"
)

// gen carries the deterministic state for generating one response.
type gen struct {
	rng    *rand.Rand
	seedHx string // hex seed material, extended per-field for honeytokens
	tokens *honeytoken.Store
	sess   string
	fpID   string
	tmpl   string
	// planted collects the honeytokens placed in this response.
	planted []honeytoken.Token
}

// seededRNG builds a PRNG from HMAC(secret, session|template|id). The same
// (session, template, id) always yields the same stream → identical fake data
// across requests, which is what stops an agent detecting the fake by replay.
func seededRNG(secret []byte, session, template, id string) (*rand.Rand, string) {
	mac := hmac.New(sha256.New, secret)
	mac.Write([]byte(session + "|" + template + "|" + id))
	sum := mac.Sum(nil)
	seed := int64(binary.BigEndian.Uint64(sum[:8]))
	return rand.New(rand.NewSource(seed)), hex.EncodeToString(sum)
}

// GenerateJSON fabricates a JSON body for the schema, consistent per session.
// It returns the body and the honeytokens planted in it.
func (e *Engine) GenerateJSON(sc *Schema, session, fpID, template, id string) ([]byte, []honeytoken.Token) {
	rng, seedHx := seededRNG(e.secret, session, template, id)
	g := &gen{rng: rng, seedHx: seedHx, tokens: e.tokens, sess: session, fpID: fpID, tmpl: template}
	v := g.value(sc.Root, "root")
	body, _ := json.MarshalIndent(v, "", "  ")
	return body, g.planted
}

// value generates a fake value for a schema node.
func (g *gen) value(n *node, path string) any {
	if n == nil {
		return nil
	}
	switch n.Kind {
	case kNull:
		return nil
	case kBool:
		return g.rng.Intn(2) == 1
	case kInt:
		return g.rng.Intn(100000)
	case kFloat:
		return float64(g.rng.Intn(100000)) / 100.0
	case kEmail:
		return fmt.Sprintf("%s.%s@example.invalid", pick(g.rng, firstNames), pick(g.rng, lastNames))
	case kUUID:
		return g.uuid()
	case kDateTime:
		return fmt.Sprintf("2026-%02d-%02dT%02d:%02d:00Z",
			1+g.rng.Intn(12), 1+g.rng.Intn(28), g.rng.Intn(24), g.rng.Intn(60))
	case kURL:
		return fmt.Sprintf("https://cdn.example.invalid/%s", g.hex(8))
	case kName:
		return pick(g.rng, firstNames) + " " + pick(g.rng, lastNames)
	case kSecret:
		return g.plantToken(n.FieldName, path)
	case kString:
		return pick(g.rng, words) + "-" + g.hex(4)
	case kArray:
		// 1–3 consistent elements.
		count := 1 + g.rng.Intn(3)
		arr := make([]any, count)
		for i := range arr {
			arr[i] = g.value(n.Elem, fmt.Sprintf("%s[%d]", path, i))
		}
		return arr
	case kObject:
		m := map[string]any{}
		for _, k := range n.Keys {
			m[k] = g.value(n.Fields[k], path+"."+k)
		}
		return m
	}
	return nil
}

// plantToken mints (deterministically) and registers a honeytoken for a
// secret-shaped field, so if the agent ever uses it, Mirage detects the trip.
func (g *gen) plantToken(field, path string) string {
	kind := honeytoken.KindAPIKey
	switch {
	case containsAny(field, "password", "passwd", "pwd"):
		kind = honeytoken.KindPassword
	case containsAny(field, "aws"):
		kind = honeytoken.KindAWSKey
	case containsAny(field, "jwt"), containsAny(field, "bearer"):
		kind = honeytoken.KindJWT
	}
	// Deterministic per-field seed so the same field in the same session+route
	// always yields the same token value (consistency), yet unique per location.
	fieldSeed := hashHex(g.seedHx + "|" + path)
	val := g.tokens.Format(kind, fieldSeed)
	tok := honeytoken.Token{
		Value: val, Kind: kind, SessionID: g.sess, FPID: g.fpID,
		Template: g.tmpl, Field: field,
	}
	g.tokens.Register(tok)
	g.planted = append(g.planted, tok)
	return val
}

func (g *gen) uuid() string {
	b := make([]byte, 16)
	for i := range b {
		b[i] = byte(g.rng.Intn(256))
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:16])
}

func (g *gen) hex(n int) string {
	b := make([]byte, n)
	for i := range b {
		b[i] = byte(g.rng.Intn(256))
	}
	return hex.EncodeToString(b)
}

func hashHex(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

func pick(rng *rand.Rand, xs []string) string { return xs[rng.Intn(len(xs))] }

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if len(sub) <= len(s) {
			for i := 0; i+len(sub) <= len(s); i++ {
				if s[i:i+len(sub)] == sub {
					return true
				}
			}
		}
	}
	return false
}

var (
	firstNames = []string{"alex", "sam", "jordan", "taylor", "casey", "morgan", "riley", "jamie"}
	lastNames  = []string{"lee", "patel", "garcia", "khan", "nguyen", "silva", "costa", "ahmed"}
	words      = []string{"alpha", "bravo", "delta", "echo", "falcon", "harbor", "lumen", "nova"}
)
