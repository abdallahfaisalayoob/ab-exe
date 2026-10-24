package scorer

import (
	"math/rand"
	"testing"

	"github.com/abdallahfaisalayoob/mirage/internal/session"
	"github.com/abdallahfaisalayoob/mirage/internal/sim"
)

// Every verdict must carry at least one reason.
func TestAlwaysHasReasons(t *testing.T) {
	sc := New()
	rng := rand.New(rand.NewSource(1))
	for _, p := range []sim.Profile{sim.Human, sim.Scanner, sim.Agent} {
		for i := 0; i < 20; i++ {
			s := sim.Gen(p, rng, i)
			res := sc.Score(s)
			if len(res.Reasons) == 0 {
				t.Fatalf("%s session produced a verdict with no reasons", p)
			}
		}
	}
}

// The core requirement: across many simulated sessions, humans are not
// shadowed (false positives near zero) while scanners and agents are detected.
func TestSeparationAndHumanFP(t *testing.T) {
	sc := New()
	rng := rand.New(rand.NewSource(42))
	const N = 400
	const shadowThreshold = 82 // default ladder shadow rung

	var humanShadowed, scannerDetected, agentDetected int
	var humanScoreSum int

	for i := 0; i < N; i++ {
		h := sc.Score(sim.Gen(sim.Human, rng, i))
		if h.Score >= shadowThreshold {
			humanShadowed++
		}
		humanScoreSum += h.Score

		sres := sc.Score(sim.Gen(sim.Scanner, rng, i))
		if sres.Score >= 60 { // scanners should be flagged well above monitor
			scannerDetected++
		}

		ares := sc.Score(sim.Gen(sim.Agent, rng, i))
		if ares.Score >= shadowThreshold {
			agentDetected++
		}
	}

	humanShadowRate := float64(humanShadowed) / float64(N)
	scannerRate := float64(scannerDetected) / float64(N)
	agentRate := float64(agentDetected) / float64(N)
	avgHuman := float64(humanScoreSum) / float64(N)

	t.Logf("human avg score=%.1f  human-shadowed=%.3f  scanner-detected=%.3f  agent-shadowed=%.3f",
		avgHuman, humanShadowRate, scannerRate, agentRate)

	// Hard requirement: no human should ever reach the shadow threshold.
	if humanShadowed != 0 {
		t.Errorf("FALSE POSITIVE: %d/%d human sessions reached shadow threshold", humanShadowed, N)
	}
	if avgHuman > 15 {
		t.Errorf("human average score too high: %.1f", avgHuman)
	}
	if scannerRate < 0.95 {
		t.Errorf("scanner detection too low: %.3f", scannerRate)
	}
	if agentRate < 0.60 {
		t.Errorf("agent shadow rate too low: %.3f", agentRate)
	}
}

// Acting on bait is near-conclusive regardless of other signals.
func TestBaitIsDecisive(t *testing.T) {
	sc := New()
	s := session.New("x", 16)
	// A couple of innocuous requests, then a bait trip.
	s.Add(session.ReqSummary{Method: "GET", Template: "/", Status: 200})
	s.Add(session.ReqSummary{Method: "GET", Template: "/internal/admin-v2", Status: 200, Baited: true})
	res := sc.Score(s)
	if res.Score < 85 {
		t.Errorf("bait trip should score very high, got %d (%v)", res.Score, res.Reasons)
	}
	found := false
	for _, r := range res.Reasons {
		if containsBait(r) {
			found = true
		}
	}
	if !found {
		t.Errorf("bait reason missing: %v", res.Reasons)
	}
}

func containsBait(s string) bool {
	for i := 0; i+4 <= len(s); i++ {
		if s[i:i+4] == "bait" {
			return true
		}
	}
	return false
}
