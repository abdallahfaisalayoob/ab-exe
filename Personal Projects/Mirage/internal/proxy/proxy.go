// Package proxy is Mirage's data path: a transparent reverse proxy to the
// origin with per-session tracking, wrapped end-to-end in fail-open guards and
// gated by a global kill switch.
//
// The pipeline is a set of optional hooks. Later milestones populate them
// (ingress guard, scorer, ladder, shadow engine, leak filter). If a hook is
// nil or panics, the request proceeds untouched toward the origin — Mirage is
// never in the critical path for availability.
package proxy

import (
	"context"
	"net/http"
	"net/http/httputil"
	"net/url"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/failopen"
	"github.com/abdallahfaisalayoob/mirage/internal/metrics"
	"github.com/abdallahfaisalayoob/mirage/internal/pathtmpl"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Decision is what a request hook asks the proxy to do next.
type Decision int

const (
	// Continue: proceed to the next hook / the origin.
	Continue Decision = iota
	// Served: the hook already wrote the full response; stop.
	Served
	// Origin: forward to origin but keep any hook-provided ResponseWriter
	// wrapper (used by the leak filter / shadow passthrough).
	Origin
)

// Context carries per-request state through the pipeline.
type Context struct {
	W       http.ResponseWriter
	R       *http.Request
	Session *session.Session
	Cfg     *config.Config
	Now     time.Time

	// Template is the normalised path.
	Template string
	// Allowlisted pins the session to monitor and skips enforcement.
	Allowlisted bool
	// AllowReason explains an allowlist hit.
	AllowReason string

	// Scoring outputs (filled by the scorer hook).
	Score, Agent, Hostile int
	Reasons               []string

	// Rung is the ladder rung chosen for this request.
	Rung string

	// RespBytes/Status captured for the session window after the origin replies.
	respBytes int64
	status    int
}

// Hooks are the optional pipeline stages. A nil hook is skipped. Each runs
// inside a fail-open guard.
type Hooks struct {
	// Allowlist decides exemption; sets Allowlisted/AllowReason on ctx.
	Allowlist func(*Context)
	// Ingress may reject a malformed request by writing a response and
	// returning Served.
	Ingress func(*Context) Decision
	// Score fills ctx.Score/Agent/Hostile/Reasons.
	Score func(*Context)
	// Ladder picks a rung and may serve a pow/tarpit/shadow/block response.
	Ladder func(*Context) Decision
	// WrapResponse optionally wraps the ResponseWriter (leak filter). It
	// returns the writer to use and a finalise func run after the origin.
	WrapResponse func(*Context, http.ResponseWriter) (http.ResponseWriter, func())
	// Observe is called once per request after the response is determined,
	// for event logging and metrics.
	Observe func(*Context)
}

// Proxy is the Mirage reverse proxy.
type Proxy struct {
	cfg       *config.Config
	sessions  *session.Store
	metrics   *metrics.Registry
	hooks     Hooks
	rp        *httputil.ReverseProxy
	originURL *url.URL
}

// New builds a proxy for the given origin.
func New(cfg *config.Config, sessions *session.Store, m *metrics.Registry, hooks Hooks) (*Proxy, error) {
	origin, err := url.Parse(cfg.Origin)
	if err != nil {
		return nil, err
	}
	p := &Proxy{
		cfg: cfg, sessions: sessions, metrics: m, hooks: hooks, originURL: origin,
	}
	rp := httputil.NewSingleHostReverseProxy(origin)
	// Preserve the original Host unless the origin demands its own.
	defaultDirector := rp.Director
	rp.Director = func(r *http.Request) {
		defaultDirector(r)
		r.Host = origin.Host
	}
	// Fail open on upstream errors: if the origin is unreachable, Mirage still
	// returns a clean 502 rather than crashing, and the event is counted.
	rp.ErrorHandler = func(w http.ResponseWriter, r *http.Request, err error) {
		m.Inc("mirage_origin_errors_total")
		w.WriteHeader(http.StatusBadGateway)
		_, _ = w.Write([]byte("upstream unavailable"))
	}
	p.rp = rp
	return p, nil
}

// ServeHTTP is the entry point.
func (p *Proxy) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	start := time.Now()
	p.metrics.Inc("mirage_requests_total")

	// Kill switch: pure pass-through, zero Mirage logic.
	if p.cfg.KillSwitch {
		p.metrics.Inc("mirage_killswitch_passthrough_total")
		p.rp.ServeHTTP(w, r)
		return
	}

	ctx := &Context{
		W: w, R: r, Cfg: p.cfg, Now: start,
		Template: pathtmpl.Normalise(r.URL.Path),
		Rung:     "monitor",
	}

	// Session identification (fail-open: on panic, proceed without a session).
	failopen.Guard("session", func() {
		sess, setCookie := p.sessions.Identify(r, tlsHint(r))
		ctx.Session = sess
		if setCookie != "" {
			http.SetCookie(w, &http.Cookie{
				Name: session.CookieName, Value: setCookie, Path: "/",
				HttpOnly: true, SameSite: http.SameSiteLaxMode,
			})
		}
	})

	// The Mirage decision logic runs only in enforce mode; in monitor mode we
	// still score+observe but never serve an alternate response.
	decision := p.runHooks(ctx)

	// Measure the latency Mirage *added* (everything before origin dispatch).
	addedBefore := time.Since(start)

	switch decision {
	case Served:
		p.metrics.ObserveLatency(addedBefore)
		p.finishSession(ctx)
		if p.hooks.Observe != nil {
			failopen.Guard("observe", func() { p.hooks.Observe(ctx) })
		}
		return
	}

	// Optionally wrap the writer (leak filter).
	writer := w
	var finalise func()
	if p.hooks.WrapResponse != nil {
		failopen.Guard("wrap", func() {
			ww, fin := p.hooks.WrapResponse(ctx, w)
			if ww != nil {
				writer = ww
			}
			finalise = fin
		})
	}

	p.metrics.ObserveLatency(addedBefore)

	// Capture status/size for the session window via a tiny wrapper.
	cap := &capture{ResponseWriter: writer}
	p.rp.ServeHTTP(cap, r)
	if finalise != nil {
		failopen.Guard("finalise", finalise)
	}

	ctx.status = cap.status
	ctx.respBytes = cap.n
	p.finishSession(ctx)
	if p.hooks.Observe != nil {
		failopen.Guard("observe", func() { p.hooks.Observe(ctx) })
	}
}

// runHooks executes the request-side pipeline, each stage fail-open.
func (p *Proxy) runHooks(ctx *Context) Decision {
	if p.hooks.Allowlist != nil {
		failopen.Guard("allowlist", func() { p.hooks.Allowlist(ctx) })
	}
	if p.hooks.Ingress != nil {
		dec := Continue
		ok := failopen.Guard("ingress", func() { dec = p.hooks.Ingress(ctx) })
		if ok && dec == Served {
			return Served
		}
	}
	if p.hooks.Score != nil {
		failopen.Guard("score", func() { p.hooks.Score(ctx) })
		if ctx.Session != nil {
			ctx.Session.Score = ctx.Score
			ctx.Session.Agent = ctx.Agent
			ctx.Session.Hostile = ctx.Hostile
			ctx.Session.Reasons = ctx.Reasons
		}
	}
	// Ladder only acts in enforce mode and never against an allowlisted client.
	if p.hooks.Ladder != nil && p.cfg.EnforceActive() && !ctx.Allowlisted {
		dec := Continue
		ok := failopen.Guard("ladder", func() { dec = p.hooks.Ladder(ctx) })
		if ok && dec == Served {
			return Served
		}
	}
	if ctx.Session != nil {
		ctx.Session.Rung = ctx.Rung
	}
	return Continue
}

func (p *Proxy) finishSession(ctx *Context) {
	if ctx.Session == nil {
		return
	}
	var reqBytes int64
	if ctx.R.ContentLength > 0 {
		reqBytes = ctx.R.ContentLength
	}
	ctx.Session.Add(session.ReqSummary{
		At:        ctx.Now,
		Method:    ctx.R.Method,
		Template:  ctx.Template,
		RawPath:   ctx.R.URL.Path,
		Status:    ctx.status,
		ReqBytes:  reqBytes,
		RespBytes: ctx.respBytes,
	})
}

// capture records status code and byte count of the response.
type capture struct {
	http.ResponseWriter
	status int
	n      int64
}

func (c *capture) WriteHeader(code int) {
	c.status = code
	c.ResponseWriter.WriteHeader(code)
}

func (c *capture) Write(b []byte) (int, error) {
	if c.status == 0 {
		c.status = http.StatusOK
	}
	n, err := c.ResponseWriter.Write(b)
	c.n += int64(n)
	return n, err
}

// Flush supports streaming responses through the capture wrapper.
func (c *capture) Flush() {
	if f, ok := c.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

// tlsHint produces a lightweight TLS stack hint when the connection carries
// TLS state. A fuller JA3-style hash would hook the ClientHello; here we use
// the negotiated version + cipher suite as a cheap, allocation-free proxy that
// still separates browsers (modern suites) from many scripting stacks.
func tlsHint(r *http.Request) string {
	if r.TLS == nil {
		return ""
	}
	// Known library stacks negotiate a narrower, older set; this is a hint, not
	// a verdict. The scorer treats it as one weak signal among many.
	return "tls:" + itoa(int(r.TLS.Version)) + ":" + itoa(int(r.TLS.CipherSuite))
}

func itoa(i int) string {
	if i == 0 {
		return "0"
	}
	var b [12]byte
	p := len(b)
	for i > 0 {
		p--
		b[p] = byte('0' + i%10)
		i /= 10
	}
	return string(b[p:])
}

// WithContext is a small helper for tests that need a cancellable proxy.
func (p *Proxy) WithContext(_ context.Context) *Proxy { return p }
