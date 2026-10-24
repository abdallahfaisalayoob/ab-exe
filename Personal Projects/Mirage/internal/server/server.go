// Package server wires Mirage's components together into the proxy handler and
// the admin handler. Each milestone attaches more hooks here; the wiring is the
// single place that assembles the pipeline.
package server

import (
	"fmt"
	"net/http"
	"sync/atomic"

	"github.com/abdallahfaisalayoob/mirage/internal/config"
	"github.com/abdallahfaisalayoob/mirage/internal/failopen"
	"github.com/abdallahfaisalayoob/mirage/internal/metrics"
	"github.com/abdallahfaisalayoob/mirage/internal/proxy"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// App holds the assembled handlers and resources.
type App struct {
	Cfg      *config.Config
	Proxy    http.Handler
	Admin    http.Handler
	Metrics  *metrics.Registry
	Sessions *session.Store

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

	hooks := app.buildHooks()

	p, err := proxy.New(cfg, sessions, m, hooks)
	if err != nil {
		return nil, err
	}
	app.Proxy = p
	app.Admin = app.buildAdmin()
	return app, nil
}

// buildHooks constructs the pipeline hooks. Milestone 1 leaves them nil
// (transparent proxy); later milestones populate them.
func (a *App) buildHooks() proxy.Hooks {
	return proxy.Hooks{}
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
		a.Metrics.WriteTo(w)
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
