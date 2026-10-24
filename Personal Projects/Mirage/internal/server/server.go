// Package server wires Mirage's components together into the proxy handler and
// the admin handler. Each milestone attaches more hooks here; the wiring is the
// single place that assembles the pipeline.
package server

import (
	"fmt"
	"log/slog"
	"net/http"
	"sync/atomic"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/failopen"
	"github.com/abdallahfaisalayoob/mirage/internal/ingress"
	"github.com/abdallahfaisalayoob/mirage/internal/metrics"
	"github.com/abdallahfaisalayoob/mirage/internal/proxy"
	"github.com/abdallahfaisalayoob/mirage/internal/scorer"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// App holds the assembled handlers and resources.
type App struct {
	Cfg      *config.Config
	Proxy    http.Handler
	Admin    http.Handler
	Metrics  *metrics.Registry
	Sessions *session.Store

	ingress *ingress.Guard
	scorer  *scorer.Scorer

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

	// Session scorer (M3). Runs every request; fills ctx with the verdict and
	// its reasons. In monitor mode this only annotates/logs; the ladder (M4)
	// decides what to do with the score, and only in enforce mode.
	if a.scorer != nil {
		h.Score = func(ctx *proxy.Context) {
			if ctx.Session == nil {
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

	return h
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

	return mux
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
