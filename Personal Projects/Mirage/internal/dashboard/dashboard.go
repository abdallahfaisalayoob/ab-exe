// Package dashboard is Mirage's small embedded control-plane UI: live sessions
// with scores and reasons, which rung each is on, honeytoken trips and leak
// hits, and one-click allow/block. Plain Go templates plus a little vanilla JS
// — no frontend framework, no build step.
package dashboard

import (
	"encoding/json"
	"html/template"
	"net/http"
	"sort"
	"strings"

	"github.com/abdallahfaisalayoob/mirage/internal/honeytoken"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Dashboard renders the control plane.
type Dashboard struct {
	Sessions   *session.Store
	Honeytoken *honeytoken.Store
	// Verdict applies an operator allow/block to a session id.
	Verdict func(sessionID, verdict string)
	tmpl    *template.Template
}

// New builds a dashboard.
func New(s *session.Store, ht *honeytoken.Store, verdict func(string, string)) *Dashboard {
	return &Dashboard{
		Sessions: s, Honeytoken: ht, Verdict: verdict,
		tmpl: template.Must(template.New("dash").Parse(pageHTML)),
	}
}

// Register mounts the dashboard routes on a mux under the given prefix.
func (d *Dashboard) Register(mux *http.ServeMux) {
	mux.HandleFunc("/", d.index)
	mux.HandleFunc("/api/sessions", d.apiSessions)
	mux.HandleFunc("/api/trips", d.apiTrips)
	mux.HandleFunc("/api/action", d.apiAction)
}

func (d *Dashboard) index(w http.ResponseWriter, r *http.Request) {
	if r.URL.Path != "/" {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = d.tmpl.Execute(w, nil)
}

// sessionView is the JSON shape for the live session table.
type sessionView struct {
	ID      string   `json:"id"`
	IP      string   `json:"ip"`
	FP      string   `json:"fp"`
	UA      string   `json:"ua"`
	Score   int      `json:"score"`
	Agent   int      `json:"agent"`
	Hostile int      `json:"hostile"`
	Rung    string   `json:"rung"`
	Reqs    int      `json:"reqs"`
	Verdict string   `json:"verdict"`
	Reasons []string `json:"reasons"`
}

func (d *Dashboard) apiSessions(w http.ResponseWriter, r *http.Request) {
	snap := d.Sessions.Snapshot()
	views := make([]sessionView, 0, len(snap))
	for _, s := range snap {
		views = append(views, sessionView{
			ID: s.ID, IP: s.IP, FP: s.FP.ID, UA: s.FP.UAFamily,
			Score: s.Score, Agent: s.Agent, Hostile: s.Hostile,
			Rung: s.Rung, Reqs: s.Len(), Verdict: s.ManualVerdict,
			Reasons: dedupe(s.Reasons),
		})
	}
	// Highest score first — the most interesting sessions on top.
	sort.Slice(views, func(i, j int) bool { return views[i].Score > views[j].Score })
	writeJSON(w, views)
}

// tripView is the JSON shape for the honeytoken trips table.
type tripView struct {
	At          string `json:"at"`
	Kind        string `json:"kind"`
	Planted     string `json:"planted_session"`
	From        string `json:"from_session"`
	FromFP      string `json:"from_fp"`
	Via         string `json:"via"`
	Path        string `json:"path"`
}

func (d *Dashboard) apiTrips(w http.ResponseWriter, r *http.Request) {
	trips := d.Honeytoken.Trips()
	views := make([]tripView, 0, len(trips))
	for i := len(trips) - 1; i >= 0; i-- { // newest first
		t := trips[i]
		views = append(views, tripView{
			At: t.PresentedAt.Format("15:04:05"), Kind: string(t.Token.Kind),
			Planted: t.Token.SessionID, From: t.FromSession, FromFP: t.FromFP,
			Via: t.Via, Path: t.RequestPath,
		})
	}
	writeJSON(w, views)
}

func (d *Dashboard) apiAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "POST only", http.StatusMethodNotAllowed)
		return
	}
	var req struct {
		Session string `json:"session"`
		Verdict string `json:"verdict"` // "allow" | "block" | ""
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "bad json", http.StatusBadRequest)
		return
	}
	if req.Verdict != "allow" && req.Verdict != "block" && req.Verdict != "" {
		http.Error(w, "bad verdict", http.StatusBadRequest)
		return
	}
	if d.Verdict != nil {
		d.Verdict(req.Session, req.Verdict)
	}
	writeJSON(w, map[string]string{"ok": "1"})
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}

func dedupe(xs []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, x := range xs {
		if x == "" || seen[x] {
			continue
		}
		seen[x] = true
		out = append(out, x)
		if len(out) >= 6 {
			break
		}
	}
	return out
}

var _ = strings.TrimSpace
