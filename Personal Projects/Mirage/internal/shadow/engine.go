package shadow

import (
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/honeytoken"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Engine serves per-session fakes and learns route shapes.
type Engine struct {
	secret []byte
	tokens *honeytoken.Store
	shapes *Store
	cfg    Config

	// OnShadow is called with metadata each time a session is shadowed (for
	// metrics/events). Optional.
	OnShadow func(sessionID, template string, planted []honeytoken.Token)
}

// Config controls the engine.
type Config struct {
	DecoyText     bool // embed defensive decoy text (mislead-only)
	HoneytokenEnv bool // serve fake .env/config/admin endpoints
	LearnTraffic  bool // learn shapes from live traffic
}

// New builds a shadow engine.
func New(secret []byte, tokens *honeytoken.Store, shapes *Store, cfg Config) *Engine {
	if shapes == nil {
		shapes = NewStore()
	}
	return &Engine{secret: secret, tokens: tokens, shapes: shapes, cfg: cfg}
}

// Shapes exposes the shape store (for the learning tap and the dashboard).
func (e *Engine) Shapes() *Store { return e.shapes }

// Handle is the ladder.ShadowHandler. It serves a consistent per-session fake
// of the requested route and returns true (it always handles the response —
// never falls through to the real origin, which would defeat the purpose).
func (e *Engine) Handle(w http.ResponseWriter, r *http.Request, s *session.Session) bool {
	template := NormaliseTemplate(r.URL.Path)
	id := r.URL.Path // concrete id material → stable per exact path
	sid, fpID := "anon", ""
	if s != nil {
		sid = s.ID
		fpID = s.FP.ID
		if s.ShadowSeed == "" {
			s.ShadowSeed = hashHex(sid)
		}
	}

	// Latency jitter: a zero-latency reply would itself betray the shadow, since
	// the real app takes time to serve. Sleep a seeded, plausible interval
	// (seeded so a session sees stable-ish timing, not a constant). This is an
	// approximation — exact per-route latency matching is a known limitation.
	e.jitter(r, sid, template)

	// Planted honeytoken endpoints (fake .env, config, admin) take priority.
	if e.cfg.HoneytokenEnv {
		if body, ct, ok := e.honeyEndpoint(r.URL.Path, sid, fpID, template); ok {
			e.write(w, 200, ct, body, nil)
			if e.OnShadow != nil {
				e.OnShadow(sid, template, nil)
			}
			return true
		}
	}

	sc, known := e.shapes.Get(template)

	switch {
	case known && sc.IsJSON && sc.Root != nil:
		body, planted := e.GenerateJSON(sc, sid, fpID, template, id)
		body = e.maybeDecorateJSON(body)
		e.write(w, statusOr(sc.Status, 200), ctOr(sc.ContentType, "application/json"), body, sc.HeaderNames)
		e.fire(sid, template, planted)
		return true

	case known && len(sc.HTMLBody) > 0:
		body := e.shadowHTML(sc.HTMLBody, sid, fpID, template, id)
		e.write(w, statusOr(sc.Status, 200), ctOr(sc.ContentType, "text/html; charset=utf-8"), body, sc.HeaderNames)
		e.fire(sid, template, nil)
		return true

	default:
		// Unknown route: synthesise a plausible fake from the request shape.
		body, ct, planted := e.synthesise(r, sid, fpID, template, id)
		e.write(w, 200, ct, body, nil)
		e.fire(sid, template, planted)
		return true
	}
}

// synthesise builds a fake for a route with no learned schema, guessing JSON
// vs HTML from the path/Accept header.
func (e *Engine) synthesise(r *http.Request, sid, fpID, template, id string) ([]byte, string, []honeytoken.Token) {
	wantsJSON := strings.Contains(r.URL.Path, "/api/") ||
		strings.HasSuffix(r.URL.Path, ".json") ||
		strings.Contains(r.Header.Get("Accept"), "application/json")
	if wantsJSON {
		// A generic object with an id, a name, a timestamp and a secret slot.
		sc := &Schema{IsJSON: true, Root: &node{Kind: kObject,
			Keys: []string{"id", "name", "created_at", "api_key", "status"},
			Fields: map[string]*node{
				"id":         {Kind: kInt, FieldName: "id"},
				"name":       {Kind: kName, FieldName: "name"},
				"created_at": {Kind: kDateTime, FieldName: "created_at"},
				"api_key":    {Kind: kSecret, FieldName: "api_key"},
				"status":     {Kind: kString, FieldName: "status"},
			}}}
		body, planted := e.GenerateJSON(sc, sid, fpID, template, id)
		return e.maybeDecorateJSON(body), "application/json", planted
	}
	// Minimal HTML with an optional decoy comment.
	var b strings.Builder
	b.WriteString("<!doctype html><html><head><title>Dashboard</title></head><body>\n")
	b.WriteString("<h1>Account</h1><p>Welcome back.</p>\n")
	if e.cfg.DecoyText {
		b.WriteString("<!-- " + DefaultDecoyText + " -->\n")
	}
	b.WriteString("</body></html>")
	return []byte(b.String()), "text/html; charset=utf-8", nil
}

// honeyEndpoint serves a fake for classic loot paths. Returns ok=false if the
// path isn't one of them.
func (e *Engine) honeyEndpoint(path, sid, fpID, template string) ([]byte, string, bool) {
	lp := strings.ToLower(path)
	switch {
	case strings.HasSuffix(lp, "/.env") || strings.HasSuffix(lp, ".env"):
		return e.fakeEnv(sid, fpID, template), "text/plain; charset=utf-8", true
	case strings.Contains(lp, "config.php") || strings.HasSuffix(lp, "/config.json"):
		return e.fakeEnv(sid, fpID, template), "text/plain; charset=utf-8", true
	case strings.Contains(lp, "credentials"):
		return e.fakeEnv(sid, fpID, template), "text/plain; charset=utf-8", true
	}
	return nil, "", false
}

// fakeEnv builds a believable .env seeded with tracked honeytokens.
func (e *Engine) fakeEnv(sid, fpID, template string) []byte {
	mk := func(kind honeytoken.Kind, field string) string {
		seed := hashHex(hashHex(sid+template) + "|" + field)
		v := e.tokens.Format(kind, seed)
		e.tokens.Register(honeytoken.Token{Value: v, Kind: kind, SessionID: sid,
			FPID: fpID, Template: template, Field: field})
		return v
	}
	var b strings.Builder
	fmt.Fprintf(&b, "APP_ENV=production\n")
	fmt.Fprintf(&b, "APP_DEBUG=false\n")
	fmt.Fprintf(&b, "DB_HOST=192.0.2.10\n") // TEST-NET-1: routes nowhere
	fmt.Fprintf(&b, "DB_USERNAME=app\n")
	fmt.Fprintf(&b, "DB_PASSWORD=%s\n", mk(honeytoken.KindPassword, "DB_PASSWORD"))
	fmt.Fprintf(&b, "API_KEY=%s\n", mk(honeytoken.KindAPIKey, "API_KEY"))
	fmt.Fprintf(&b, "AWS_ACCESS_KEY_ID=%s\n", mk(honeytoken.KindAWSKey, "AWS_ACCESS_KEY_ID"))
	fmt.Fprintf(&b, "AWS_SECRET_ACCESS_KEY=%s\n", mk(honeytoken.KindAPIKey, "AWS_SECRET_ACCESS_KEY"))
	if e.cfg.DecoyText {
		fmt.Fprintf(&b, "# %s\n", DefaultDecoyText)
	}
	return []byte(b.String())
}

func (e *Engine) fire(sid, template string, planted []honeytoken.Token) {
	if e.OnShadow != nil {
		e.OnShadow(sid, template, planted)
	}
}

func (e *Engine) write(w http.ResponseWriter, status int, ct string, body []byte, headerNames []string) {
	w.Header().Set("Content-Type", ct)
	// Mirror a couple of innocuous learned header names so the shape matches.
	for _, h := range headerNames {
		switch strings.ToLower(h) {
		case "cache-control":
			w.Header().Set("Cache-Control", "no-store")
		case "x-request-id":
			w.Header().Set("X-Request-Id", randishID())
		}
	}
	w.WriteHeader(status)
	_, _ = w.Write(body)
}

func statusOr(s, def int) int {
	if s == 0 {
		return def
	}
	return s
}
func ctOr(s, def string) string {
	if s == "" {
		return def
	}
	return s
}

func randishID() string { return hashHex(fmt.Sprintf("%d", http.StatusOK))[:16] }

// jitter sleeps a seeded, plausible per-session interval (~25–160ms) so shadow
// responses don't return in suspiciously uniform near-zero time. Honours
// request cancellation so it never holds a goroutine past the client.
func (e *Engine) jitter(r *http.Request, sid, template string) {
	rng, _ := seededRNG(e.secret, sid, template, "latency")
	d := time.Duration(25+rng.Intn(135)) * time.Millisecond
	select {
	case <-r.Context().Done():
	case <-time.After(d):
	}
}
