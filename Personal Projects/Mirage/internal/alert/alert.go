// Package alert delivers Mirage notifications to external sinks: a webhook
// (JSON POST) and/or syslog. Alerts fire on honeytoken trips (critical), leak
// redactions, and operator actions. Delivery is best-effort and never blocks
// the data path.
package alert

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"log/syslog"
	"net/http"
	"time"
)

// Severity of an alert.
type Severity string

const (
	Info     Severity = "info"
	Warning  Severity = "warning"
	Critical Severity = "critical"
)

// Alert is a structured notification.
type Alert struct {
	At       time.Time `json:"at"`
	Severity Severity  `json:"severity"`
	Kind     string    `json:"kind"`
	Title    string    `json:"title"`
	Detail   string    `json:"detail"`
	Session  string    `json:"session,omitempty"`
	FP       string    `json:"fingerprint,omitempty"`
	Path     string    `json:"path,omitempty"`
}

// Sink delivers an alert.
type Sink interface{ Send(Alert) }

// Fanout sends to several sinks.
type Fanout struct{ sinks []Sink }

// NewFanout builds a fan-out sink.
func NewFanout(sinks ...Sink) *Fanout { return &Fanout{sinks: sinks} }

// Send delivers to all sinks asynchronously (never blocks the caller).
func (f *Fanout) Send(a Alert) {
	if a.At.IsZero() {
		a.At = time.Now()
	}
	for _, s := range f.sinks {
		s := s
		go s.Send(a)
	}
}

// Webhook posts alerts as JSON.
type Webhook struct {
	URL    string
	Client *http.Client
}

// NewWebhook builds a webhook sink.
func NewWebhook(url string) *Webhook {
	return &Webhook{URL: url, Client: &http.Client{Timeout: 5 * time.Second}}
}

func (w *Webhook) Send(a Alert) {
	body, _ := json.Marshal(a)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, w.URL, bytes.NewReader(body))
	if err != nil {
		return
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := w.Client.Do(req)
	if err != nil {
		slog.Warn("alert webhook failed", "err", err)
		return
	}
	resp.Body.Close()
}

// Syslog sends alerts to a syslog endpoint.
type Syslog struct{ w *syslog.Writer }

// NewSyslog connects to a syslog endpoint ("" => local).
func NewSyslog(addr string) (*Syslog, error) {
	var w *syslog.Writer
	var err error
	if addr == "" {
		w, err = syslog.New(syslog.LOG_WARNING|syslog.LOG_DAEMON, "mirage")
	} else {
		w, err = syslog.Dial("udp", addr, syslog.LOG_WARNING|syslog.LOG_DAEMON, "mirage")
	}
	if err != nil {
		return nil, err
	}
	return &Syslog{w: w}, nil
}

func (s *Syslog) Send(a Alert) {
	line, _ := json.Marshal(a)
	switch a.Severity {
	case Critical:
		_ = s.w.Crit(string(line))
	case Warning:
		_ = s.w.Warning(string(line))
	default:
		_ = s.w.Info(string(line))
	}
}

// Logger is a fallback sink that writes to slog (always available).
type Logger struct{}

func (Logger) Send(a Alert) {
	slog.Info("alert", "severity", a.Severity, "kind", a.Kind,
		"title", a.Title, "session", a.Session, "fp", a.FP, "path", a.Path)
}
