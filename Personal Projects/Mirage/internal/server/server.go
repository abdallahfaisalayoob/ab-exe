// Package server wires Mirage's components together into the proxy handler and
// the admin handler. Each milestone attaches more hooks here; the wiring is the
// single place that assembles the pipeline.
package server

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"os"
	"sync/atomic"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/failopen"
	"github.com/abdallahfaisalayoob/mirage/internal/honeytoken"
	"github.com/abdallahfaisalayoob/mirage/internal/ingress"
	"github.com/abdallahfaisalayoob/mirage/internal/ladder"
	"github.com/abdallahfaisalayoob/mirage/internal/metrics"
	"github.com/abdallahfaisalayoob/mirage/internal/proxy"
	"github.com/abdallahfaisalayoob/mirage/internal/scorer"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
	"github.com/abdallahfaisalayoob/mirage/internal/shadow"
)

// App holds the assembled handlers and resources.
type App struct {
	Cfg      *config.Config
	Proxy    http.Handler
	Admin    http.Handler
	Metrics  *metrics.Registry
	Sessions *session.Store

	ingress    *ingress.Guard
	scorer     *scorer.Scorer
	ladder     *ladder.Ladder
	shadow     *shadow.Engine
	honeytoken *honeytoken.Store

	closers []func()
}

// Build assembles the application from config. (Milestone 1: proxy core,
// sessions, metrics, admin with kill switch. Later milestones extend here.)
func Build(cfg *config.Config) (*App, error) {
	m := metrics.New()
	sessions := session.NewStore(cfg.ServerSecret, cfg.Scorer.WindowSize)

	app := &App{Cfg: cfg, Metrics: m, Sessions: sessions}

	// Live gauges.
	m.Gauge("mirage_sessions_active", func() float64 { return float64(sessions.Count()) })
	m.Gauge("mirage_failopen_total", func() float64 { return float64(failopen.Failures()) })
	m.Gauge("mirage_kill_switch", func() float64 {
		if cfg.KillSwitch {
			return 1
		}
		return 0
	})

	// Ingress guard (M2).
	guard, err := ingress.New(cfg.Ingress)
	if err != nil {
		return nil, fmt.Errorf("ingress: %w", err)
	}
	app.ingress = guard

	// Session scorer (M3).
	if cfg.Scorer.Enabled {
		app.scorer = scorer.New()
	}

	// Honeytoken store (M5). Always built: trip detection is read-only and safe
	// to run in any mode. A trip fires a critical alert carrying the session FP.
	app.honeytoken = honeytoken.NewStore(cfg.Shadow.TokenPrefix, func(t honeytoken.Trip) {
		m.Inc("mirage_honeytoken_trips_total")
		slog.Error("HONEYTOKEN TRIP",
			"token_kind", t.Token.Kind, "planted_session", t.Token.SessionID,
			"from_session", t.FromSession, "from_fp", t.FromFP,
			"via", t.Via, "path", t.RequestPath)
	})

	// Shadow engine (M5). Learns route shapes; serves per-session fakes.
	secret := []byte(cfg.ServerSecret)
	if len(secret) == 0 {
		secret = sessions.Secret()
	}
	app.shadow = shadow.New(secret, app.honeytoken, shadow.NewStore(), shadow.Config{
		DecoyText:     cfg.Shadow.DecoyText,
		HoneytokenEnv: cfg.Shadow.HoneytokenEnv,
		LearnTraffic:  cfg.Shadow.LearnFromAPI,
	})
	app.shadow.OnShadow = func(sid, tmpl string, planted []honeytoken.Token) {
		m.Inc("mirage_shadow_responses_total")
		m.Add("mirage_honeytokens_planted_total", int64(len(planted)))
	}
	m.Gauge("mirage_honeytokens_active", func() float64 { return float64(app.honeytoken.Count()) })
	m.Gauge("mirage_shadow_shapes_learned", func() float64 { return float64(app.shadow.Shapes().Count()) })

	// Response ladder (M4/M5). The shadow rung is wired to the shadow engine;
	// if shadow is disabled in config, the engine is still built for learning
	// but the ladder won't route to it unless shadow.enabled and the rung is
	// reachable (max_rung >= shadow).
	if cfg.Ladder.Enabled {
		exposeRung := os.Getenv("MIRAGE_EXPOSE_RUNG") == "1"
		var sh ladder.ShadowHandler
		if cfg.Shadow.Enabled {
			sh = func(w http.ResponseWriter, r *http.Request, s *session.Session) bool {
				// Extra gates: must look BOTH automated and hostile enough.
				if s != nil && (s.Agent < cfg.Shadow.MinAgent || s.Hostile < cfg.Shadow.MinHostile) {
					return false // fall back to tarpit; don't shadow the unsure
				}
				return app.shadow.Handle(w, r, s)
			}
		}
		app.ladder = ladder.New(cfg.Ladder, sh, exposeRung)
	}

	hooks := app.buildHooks()

	p, err := proxy.New(cfg, sessions, m, hooks)
	if err != nil {
		return nil, err
	}
	app.Proxy = p
	app.Admin = app.buildAdmin()
	return app, nil
}

// buildHooks constructs the pipeline hooks. Populated milestone by milestone.
func (a *App) buildHooks() proxy.Hooks {
	h := proxy.Hooks{}

	// Ingress guard (M2). In monitor mode it records violations but never
	// rejects; only in enforce mode does it serve an error response.
	if a.ingress != nil {
		h.Ingress = func(ctx *proxy.Context) proxy.Decision {
			v := a.ingress.Inspect(ctx.R)
			if v == nil {
				return proxy.Continue
			}
			a.Metrics.Inc("mirage_ingress_violations_total")
			reason := "ingress:" + v.Rule + " (" + v.Detail + ")"
			ctx.Reasons = append(ctx.Reasons, reason)
			if ctx.Session != nil {
				ctx.Session.Reasons = append(ctx.Session.Reasons, reason)
			}
			if a.Cfg.EnforceActive() && !ctx.Allowlisted {
				a.Metrics.Inc("mirage_ingress_rejected_total")
				ctx.W.Header().Set("Content-Type", "text/plain; charset=utf-8")
				ctx.W.WriteHeader(v.Code)
				_, _ = ctx.W.Write([]byte("request rejected\n"))
				return proxy.Served
			}
			slog.Info("ingress violation (monitor)", "rule", v.Rule,
				"detail", v.Detail, "path", ctx.R.URL.Path)
			return proxy.Continue
		}
	}

	// Honeytoken scan + session scorer (M3/M5). Always installed when either is
	// present. Trip detection is read-only and runs in every mode; scoring only
	// annotates/logs in monitor mode (the ladder acts only in enforce mode).
	if a.scorer != nil || a.honeytoken != nil {
		h.Score = func(ctx *proxy.Context) {
			if a.honeytoken != nil {
				a.scanForTrips(ctx)
			}
			if a.scorer == nil || ctx.Session == nil {
				return
			}
			res := a.scorer.Score(ctx.Session)
			ctx.Score, ctx.Agent, ctx.Hostile = res.Score, res.Agent, res.Hostile
			ctx.Reasons = append(ctx.Reasons, res.Reasons...)
			a.Metrics.Inc("mirage_scored_total")
			if res.Score >= 82 {
				a.Metrics.Inc("mirage_score_ge82_total")
			} else if res.Score >= 55 {
				a.Metrics.Inc("mirage_score_ge55_total")
			}
		}
	}

	// Response ladder (M4). Only reached in enforce mode for non-allowlisted
	// sessions (the proxy gates that). Picks a rung from the combined score and
	// serves it; a Served decision stops forwarding to the origin.
	if a.ladder != nil {
		h.Ladder = func(ctx *proxy.Context) proxy.Decision {
			rung := ladder.Decide(ctx.Score, a.Cfg.Ladder)
			ctx.Rung = rung.String()
			if ctx.Session != nil {
				ctx.Session.Rung = ctx.Rung
			}
			if rung == ladder.RungMonitor {
				return proxy.Continue
			}
			a.Metrics.Inc("mirage_rung_" + rung.String() + "_total")
			if a.ladder.Serve(rung, ctx.W, ctx.R, ctx.Session) {
				return proxy.Served
			}
			return proxy.Continue
		}
	}

	// Response-learning tap (M5). On the ORIGIN path only (shadow responses are
	// Served and never reach here), sample real responses to learn route shapes
	// for the shadow engine. Bounded buffering protects the latency budget.
	if a.shadow != nil && a.Cfg.Shadow.LearnFromAPI {
		h.WrapResponse = func(ctx *proxy.Context, w http.ResponseWriter) (http.ResponseWriter, func()) {
			lw := &learnWriter{ResponseWriter: w, cap: 32 << 10}
			return lw, func() {
				a.shadow.Shapes().Observe(ctx.Template, lw.status,
					lw.Header().Get("Content-Type"), headerNamesOf(lw.Header()), lw.buf)
			}
		}
	}

	return h
}

// scanForTrips scans an inbound request for any planted honeytoken value. A hit
// proves the client is replaying data it could only have obtained from a shadow
// response — a critical signal. It marks the session baited so the scorer and
// ladder treat it as near-conclusive.
func (a *App) scanForTrips(ctx *proxy.Context) {
	r := ctx.R
	// Cheap surfaces first: path, query, a few headers.
	surfaces := r.URL.Path + " " + r.URL.RawQuery + " " +
		r.Header.Get("Authorization") + " " + r.Header.Get("X-Api-Key") + " " +
		r.Header.Get("Cookie")
	if tok, ok := a.honeytoken.Scan(surfaces); ok {
		a.reportTrip(ctx, tok, "request")
		return
	}
	// Bounded body prefix (restore for the origin).
	if r.Body != nil && r.ContentLength != 0 {
		const max = 16 << 10
		buf, _ := readPrefix(r, max)
		if len(buf) > 0 {
			if tok, ok := a.honeytoken.Scan(string(buf)); ok {
				a.reportTrip(ctx, tok, "request")
			}
		}
	}
}

func (a *App) reportTrip(ctx *proxy.Context, tok honeytoken.Token, via string) {
	sid, fp := "", ""
	if ctx.Session != nil {
		sid, fp = ctx.Session.ID, ctx.Session.FP.ID
	}
	a.honeytoken.Report(tok, sid, fp, via, ctx.R.URL.Path)
	ctx.Reasons = append(ctx.Reasons, "honeytoken presented back to Mirage (critical)")
	// Record bait on the just-finishing request via a synthetic window entry is
	// handled by the scorer next request; for immediacy, bump hostility now.
	ctx.Hostile = 100
	ctx.Agent = max100(ctx.Agent, 80)
}

func max100(a, b int) int {
	if a > b {
		return a
	}
	return b
}

// buildAdmin constructs the admin handler: health, metrics, kill switch.
func (a *App) buildAdmin() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/plain; version=0.0.4")
		a.Metrics.Render(w)
	})

	// Kill switch toggle. POST /admin/kill?on=1 flips the global switch so an
	// operator can instantly degrade Mirage to pass-through without a restart.
	mux.HandleFunc("/admin/kill", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		on := r.URL.Query().Get("on") == "1"
		a.Cfg.KillSwitch = on
		killState.Store(boolToInt32(on))
		fmt.Fprintf(w, "kill_switch=%v\n", on)
	})

	// Honeytoken check API (M5). Other systems report a token they saw; if it's
	// one Mirage planted, a critical trip alert fires. Mounted on the admin mux.
	mux.HandleFunc("/_mirage/api/check", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			http.Error(w, "POST only", http.StatusMethodNotAllowed)
			return
		}
		var req struct {
			Token  string `json:"token"`
			Source string `json:"source"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 64<<10)).Decode(&req); err != nil {
			http.Error(w, "bad json", http.StatusBadRequest)
			return
		}
		tok, ok := a.honeytoken.Check(req.Token)
		if !ok {
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"match":false}`))
			return
		}
		src := req.Source
		if src == "" {
			src = "check-api"
		}
		a.honeytoken.Report(tok, tok.SessionID, tok.FPID, "check-api", src)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"match":true,"alerted":true}`))
	})

	return mux
}

// learnWriter buffers a bounded prefix of a response body for shape learning
// while passing bytes straight through to the real writer.
type learnWriter struct {
	http.ResponseWriter
	status int
	cap    int
	buf    []byte
}

func (l *learnWriter) WriteHeader(code int) {
	l.status = code
	l.ResponseWriter.WriteHeader(code)
}

func (l *learnWriter) Write(b []byte) (int, error) {
	if l.status == 0 {
		l.status = http.StatusOK
	}
	if len(l.buf) < l.cap {
		need := l.cap - len(l.buf)
		if need > len(b) {
			need = len(b)
		}
		l.buf = append(l.buf, b[:need]...)
	}
	return l.ResponseWriter.Write(b)
}

func (l *learnWriter) Flush() {
	if f, ok := l.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func headerNamesOf(h http.Header) []string {
	out := make([]string, 0, len(h))
	for k := range h {
		out = append(out, k)
	}
	return out
}

// readPrefix reads up to max bytes from the request body and restores the body
// (prefix + remainder) so the origin still receives it intact.
func readPrefix(r *http.Request, max int64) ([]byte, error) {
	lr := io.LimitReader(r.Body, max)
	buf, err := io.ReadAll(lr)
	if err != nil {
		r.Body = io.NopCloser(bytesReader(buf))
		return buf, err
	}
	// Chain the prefix we read with whatever remains unread.
	r.Body = struct {
		io.Reader
		io.Closer
	}{io.MultiReader(bytesReader(buf), r.Body), r.Body}
	return buf, nil
}

var killState atomic.Int32

func boolToInt32(b bool) int32 {
	if b {
		return 1
	}
	return 0
}

// Close releases resources (event store, etc.).
func (a *App) Close() {
	for _, c := range a.closers {
		c()
	}
}

func bytesReader(b []byte) io.Reader { return bytes.NewReader(b) }
