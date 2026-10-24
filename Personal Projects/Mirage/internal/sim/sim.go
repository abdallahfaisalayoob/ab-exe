// Package sim generates labelled synthetic traffic for three profiles —
// ordinary humans, dumb scripted scanners, and LLM-agent-style attackers — so
// the scorer can be evaluated and tuned. It produces the *shape* of attacks
// (timing, enumeration, mutation, acting on bait), never working exploit code.
package sim

import (
	"fmt"
	"math"
	"math/rand"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/fingerprint"
	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Profile labels a traffic generator.
type Profile int

const (
	Human Profile = iota
	Scanner
	Agent
)

func (p Profile) String() string {
	switch p {
	case Human:
		return "human"
	case Scanner:
		return "scanner"
	case Agent:
		return "agent"
	}
	return "unknown"
}

// realPaths are legitimate routes of the toy app a human would visit.
var realPaths = []struct {
	tmpl, method string
}{
	{"/", "GET"},
	{"/products", "GET"},
	{"/products/{id}", "GET"},
	{"/cart", "GET"},
	{"/about", "GET"},
	{"/login", "GET"},
	{"/login", "POST"},
	{"/account", "GET"},
}

// scanWordlist is what a dumb scanner blindly tries.
var scanWordlist = []string{
	"/admin", "/wp-admin", "/.env", "/config.php", "/backup.zip", "/.git/config",
	"/phpinfo.php", "/server-status", "/api/v1/users", "/api/v1/admin",
	"/shell.php", "/test.php", "/old", "/dev", "/staging", "/debug",
	"/.aws/credentials", "/db.sql", "/users.json", "/robots.txt",
}

// baitPaths are Mirage-planted lures only something reading response content
// would discover (e.g. a path hidden in an HTML comment or JSON field).
var baitPaths = []string{
	"/internal/admin-v2", "/api/_debug/token", "/.env.bak", "/api/keys/rotate",
}

// Gen builds one labelled session for the given profile.
func Gen(p Profile, rng *rand.Rand, idx int) *session.Session {
	s := session.New(fmt.Sprintf("%s-%d", p, idx), 128)
	switch p {
	case Human:
		genHuman(s, rng)
	case Scanner:
		genScanner(s, rng)
	case Agent:
		genAgent(s, rng)
	}
	return s
}

func genHuman(s *session.Session, rng *rand.Rand) {
	// Consistent browser fingerprint.
	s.SetFP(fingerprint.Print{UAFamily: "chrome", Inconsistent: false})
	n := 6 + rng.Intn(18)
	t := time.Now().Add(-time.Duration(n) * 6 * time.Second)
	for i := 0; i < n; i++ {
		r := realPaths[rng.Intn(len(realPaths))]
		status := 200
		if rng.Float64() < 0.03 { // rare mistyped URL
			status = 404
		}
		// Human gaps: lognormal, mean ~5s, heavy variance (reading, thinking,
		// wandering off). Occasional very long pause.
		gap := lognormal(rng, 1.4, 0.9)
		if rng.Float64() < 0.1 {
			gap += 20 + rng.Float64()*40
		}
		t = t.Add(time.Duration(gap * float64(time.Second)))
		payload := ""
		if r.method == "POST" {
			payload = "shape:login" // stable shape
		}
		s.Add(session.ReqSummary{
			At: t, Method: r.method, Template: r.tmpl, RawPath: r.tmpl,
			Status: status, PayloadHash: payload,
		})
	}
}

func genScanner(s *session.Session, rng *rand.Rand) {
	// Honest automation UA (consistent) — a dumb scanner doesn't spoof.
	s.SetFP(fingerprint.Print{UAFamily: "python-requests", Inconsistent: false})
	n := 30 + rng.Intn(50)
	t := time.Now().Add(-time.Duration(n) * 120 * time.Millisecond)
	for i := 0; i < n; i++ {
		path := scanWordlist[i%len(scanWordlist)]
		status := 404
		if path == "/robots.txt" || path == "/products" {
			status = 200
		}
		// Metronomic, very short gaps (low CV).
		gap := 0.08 + rng.NormFloat64()*0.01
		if gap < 0.01 {
			gap = 0.01
		}
		t = t.Add(time.Duration(gap * float64(time.Second)))
		s.Add(session.ReqSummary{
			At: t, Method: "GET", Template: path, RawPath: path, Status: status,
		})
	}
}

func genAgent(s *session.Session, rng *rand.Rand) {
	// Half the time the agent spoofs a browser UA while using a tool stack.
	inconsistent := rng.Float64() < 0.5
	fam := "python-httpx"
	if inconsistent {
		fam = "chrome"
	}
	s.SetFP(fingerprint.Print{UAFamily: fam, Inconsistent: inconsistent})

	n := 14 + rng.Intn(24)
	t := time.Now().Add(-time.Duration(n) * 6 * time.Second)

	// The agent enumerates a target route, hits errors, mutates payloads, and
	// eventually follows a planted bait path.
	target := "/api/v1/users/{id}"
	mutationShapes := []string{"shape:a", "shape:b", "shape:c", "shape:d"}
	tookBait := rng.Float64() < 0.65
	baitAt := n/2 + rng.Intn(max(1, n/3))

	for i := 0; i < n; i++ {
		// think-time gap: 1.5–20s, semi-regular (the tool-call loop).
		gap := 2.0 + math.Abs(rng.NormFloat64())*3.5
		if gap > 20 {
			gap = 20
		}
		t = t.Add(time.Duration(gap * float64(time.Second)))

		tmpl := target
		method := "GET"
		status := 200
		payload := ""
		baited := false

		switch {
		case tookBait && i == baitAt:
			// Acts on a lure only visible by reading response content.
			tmpl = baitPaths[rng.Intn(len(baitPaths))]
			baited = true
			status = 200
		case i%3 == 2:
			// probe that 404s, then it keeps chasing (error-seeking)
			tmpl = fmt.Sprintf("/api/v1/%s", scanWordlist[rng.Intn(len(scanWordlist))][1:])
			status = 404
		default:
			// enumerate IDs and mutate payloads, especially after an error
			method = "POST"
			payload = mutationShapes[i%len(mutationShapes)]
			if rng.Float64() < 0.4 {
				status = 400 // triggers mutation on the next same-route POST
			}
		}
		s.Add(session.ReqSummary{
			At: t, Method: method, Template: tmpl, RawPath: tmpl,
			Status: status, PayloadHash: payload, Baited: baited,
		})
	}
}

func lognormal(rng *rand.Rand, mu, sigma float64) float64 {
	return math.Exp(mu + sigma*rng.NormFloat64())
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
