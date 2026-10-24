package scorer

import (
	"fmt"
	"math"
	"sort"

	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Result is a scoring verdict. A Result without Reasons is a bug; the scorer
// guarantees at least one reason whenever a score is non-trivial.
type Result struct {
	Agent   int      // 0–100, how automated/LLM-like
	Hostile int      // 0–100, how attack-like
	Score   int      // combined 0–100
	Reasons []string // human-readable, ordered by contribution
}

// LinModel is a logistic-regression model over the feature vector. The weights
// are explainable: each term's contribution is reported as a reason.
type LinModel struct {
	Bias    float64
	Weights featureWeights
}

// featureWeights names each weight so reasons can be generated from them.
type featureWeights struct {
	MedianGap      float64
	ThinkBandShare float64
	GapRegularity  float64
	Breadth        float64
	NotFoundRatio  float64
	ErrorSeek      float64
	MutationShare  float64
	FPInconsistent float64
	WriteRatio     float64
}

// Scorer combines two models (agent, hostile) plus deterministic hard signals.
type Scorer struct {
	agent   LinModel
	hostile LinModel
}

// New returns a scorer using the built-in (trained) weights.
func New() *Scorer {
	return &Scorer{agent: AgentModel(), hostile: HostileModel()}
}

// NewWith lets training/tests supply custom models.
func NewWith(agent, hostile LinModel) *Scorer {
	return &Scorer{agent: agent, hostile: hostile}
}

// contrib pairs a reason string with its weighted contribution, for ranking.
type contrib struct {
	reason string
	weight float64
}

// Score evaluates a session and returns an explained verdict.
func (s *Scorer) Score(sess *session.Session) Result {
	f := Extract(sess)
	return s.score(f)
}

// ScoreFeatures evaluates a precomputed feature vector (used by the simulator
// and training for speed).
func (s *Scorer) ScoreFeatures(f Features) Result {
	return s.score(f)
}

func (s *Scorer) score(f Features) Result {
	agent, aContribs := s.agent.eval(f, agentReasons)
	hostile, hContribs := s.hostile.eval(f, hostileReasons)

	res := Result{Agent: pct(agent), Hostile: pct(hostile)}

	// Collect reasons from both axes, ranked by contribution magnitude.
	all := append(aContribs, hContribs...)

	// --- deterministic hard signals (facts, not probabilities) ---
	if f.Baited == 1 {
		// Acting on planted bait is near-conclusive: boost both axes.
		res.Agent = clamp(res.Agent + 30)
		res.Hostile = clamp(res.Hostile + 40)
		all = append(all, contrib{"acted on planted bait (honeytoken/decoy path)", 10})
	}
	if f.FPInconsistent == 1 {
		res.Agent = clamp(res.Agent + 15)
		all = append(all, contrib{"fingerprint inconsistent (UA vs headers/TLS)", 3})
	}

	// Combined score: an attacker must look BOTH automated and hostile. A fast
	// but benign client (agent-high, hostile-low) stays low, protecting humans
	// who merely browse quickly.
	combined := float64(res.Agent) * float64(res.Hostile) / 100.0
	// Bait short-circuits the multiplicative gate: a confirmed trip is serious
	// even if one axis is modest.
	if f.Baited == 1 {
		combined = math.Max(combined, 90)
	}
	res.Score = clamp(int(math.Round(combined)))

	res.Reasons = topReasons(all, 5)
	if len(res.Reasons) == 0 {
		res.Reasons = []string{"no notable signals; baseline traffic"}
	}
	return res
}

// eval computes the logistic output and the per-feature contributions, using
// the supplied reason templates.
func (m LinModel) eval(f Features, reasons reasonSet) (float64, []contrib) {
	w := m.Weights
	terms := []struct {
		x float64
		w float64
		r func(float64) (string, bool)
	}{
		{f.MedianGap, w.MedianGap, reasons.MedianGap},
		{f.ThinkBandShare, w.ThinkBandShare, reasons.ThinkBandShare},
		{f.GapRegularity, w.GapRegularity, reasons.GapRegularity},
		{f.Breadth, w.Breadth, reasons.Breadth},
		{f.NotFoundRatio, w.NotFoundRatio, reasons.NotFoundRatio},
		{f.ErrorSeek, w.ErrorSeek, reasons.ErrorSeek},
		{f.MutationShare, w.MutationShare, reasons.MutationShare},
		{f.FPInconsistent, w.FPInconsistent, reasons.FPInconsistent},
		{f.WriteRatio, w.WriteRatio, reasons.WriteRatio},
	}
	z := m.Bias
	var cs []contrib
	for _, t := range terms {
		c := t.x * t.w
		z += c
		if t.r != nil && c > 0.15 {
			if str, ok := t.r(t.x); ok {
				cs = append(cs, contrib{str, c})
			}
		}
	}
	return sigmoid(z), cs
}

func topReasons(cs []contrib, n int) []string {
	sort.SliceStable(cs, func(i, j int) bool { return cs[i].weight > cs[j].weight })
	out := make([]string, 0, n)
	seen := map[string]bool{}
	for _, c := range cs {
		if seen[c.reason] {
			continue
		}
		seen[c.reason] = true
		out = append(out, c.reason)
		if len(out) >= n {
			break
		}
	}
	return out
}

func sigmoid(z float64) float64 { return 1 / (1 + math.Exp(-z)) }
func pct(p float64) int         { return clamp(int(math.Round(p * 100))) }
func clamp(v int) int {
	if v < 0 {
		return 0
	}
	if v > 100 {
		return 100
	}
	return v
}

// reasonSet holds a reason generator per feature. Each returns the reason
// string and whether it applies at the given feature value.
type reasonSet struct {
	MedianGap      func(float64) (string, bool)
	ThinkBandShare func(float64) (string, bool)
	GapRegularity  func(float64) (string, bool)
	Breadth        func(float64) (string, bool)
	NotFoundRatio  func(float64) (string, bool)
	ErrorSeek      func(float64) (string, bool)
	MutationShare  func(float64) (string, bool)
	FPInconsistent func(float64) (string, bool)
	WriteRatio     func(float64) (string, bool)
}

var agentReasons = reasonSet{
	MedianGap: func(x float64) (string, bool) { return "very short, machine-like request intervals", x > 0.4 },
	ThinkBandShare: func(x float64) (string, bool) {
		return fmt.Sprintf("LLM-style think-time pauses (%.0f%% of gaps)", x*100), x > 0.3
	},
	GapRegularity:  func(x float64) (string, bool) { return "metronomic request timing (scripted)", x > 0.55 },
	FPInconsistent: func(float64) (string, bool) { return "client fingerprint inconsistent with claimed browser", true },
	WriteRatio:     func(x float64) (string, bool) { return "unusually high share of state-changing requests", x > 0.5 },
}

var hostileReasons = reasonSet{
	Breadth: func(x float64) (string, bool) { return "broad, systematic endpoint enumeration", x > 0.6 },
	NotFoundRatio: func(x float64) (string, bool) {
		return fmt.Sprintf("high 404 ratio (%.0f%%), probing for hidden paths", x*100), x > 0.25
	},
	ErrorSeek:     func(x float64) (string, bool) { return "error-seeking: requests chase 4xx/5xx responses", x > 0.3 },
	MutationShare: func(x float64) (string, bool) { return "payload mutation after errors/blocks", x > 0.1 },
}
