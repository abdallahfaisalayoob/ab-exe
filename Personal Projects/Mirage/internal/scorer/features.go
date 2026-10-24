// Package scorer turns a session's rolling request window into two explainable
// scores — how *agent-like* (automated/LLM-driven) and how *hostile*
// (attack-like) the session is — each 0–100, always with human-readable
// reasons. No verdict is ever returned without reasons.
//
// The design is deliberately small and transparent (see DECISIONS.md D4):
// a fixed feature vector feeds a logistic-regression combiner whose per-feature
// contributions double as the reasons. Deterministic hard signals (honeytoken
// bait, ingress violations, fingerprint contradiction) are applied on top as
// overrides, because those are facts, not probabilities.
package scorer

import (
	"math"
	"sort"

	"github.com/abdallahfaisalayoob/mirage/internal/session"
)

// Features is the fixed feature vector extracted from a session window.
// Every field is normalised to roughly [0,1] so weights are comparable.
type Features struct {
	MedianGap        float64 // normalised: 1 at 0s, →0 as gaps grow (fast = automated)
	ThinkBandShare   float64 // share of post-response gaps in the 1.5–20s LLM band
	GapRegularity    float64 // 1 = metronomic (low CV), 0 = human-irregular
	Breadth          float64 // distinct templates per minute, normalised
	NotFoundRatio    float64 // share of 404s
	ErrorSeek        float64 // share of requests right after a 4xx/5xx
	MutationShare    float64 // same route, changed payload shape, after an error
	FPInconsistent   float64 // 0/1 UA vs headers/TLS contradiction
	Baited           float64 // 0/1 acted on planted bait (hard signal)
	WriteRatio       float64 // share of state-changing methods
	Count            int     // window size (context, not a weighted feature)
}

// think-time band for LLM tool-call loops.
const (
	thinkLow  = 1.5
	thinkHigh = 20.0
)

// Extract computes the feature vector for a session.
func Extract(s *session.Session) Features {
	w := s.Window()
	f := Features{Count: len(w)}
	if len(w) == 0 {
		return f
	}

	// --- gaps / cadence ---
	gaps := make([]float64, 0, len(w))
	bandHits, bandTotal := 0, 0
	for i := 1; i < len(w); i++ {
		g := w[i].At.Sub(w[i-1].At).Seconds()
		if g < 0 {
			g = 0
		}
		gaps = append(gaps, g)
		// think-time band only counts gaps that follow a completed response.
		bandTotal++
		if g >= thinkLow && g <= thinkHigh {
			bandHits++
		}
	}
	if len(gaps) > 0 {
		med := median(gaps)
		// Map median gap to [0,1]: <=0.2s → ~1 (fast bot), 10s → ~0.
		f.MedianGap = math.Exp(-med / 3.0)
		f.GapRegularity = regularity(gaps)
	}
	if bandTotal > 0 {
		f.ThinkBandShare = float64(bandHits) / float64(bandTotal)
	}

	// --- breadth / errors / mutation ---
	templates := map[string]struct{}{}
	var notFound, afterErr, mutations, writes int
	payloadByTemplate := map[string]string{}
	for i, r := range w {
		templates[r.Template] = struct{}{}
		if r.Status == 404 {
			notFound++
		}
		if r.AfterError {
			afterErr++
		}
		if r.Method == "POST" || r.Method == "PUT" || r.Method == "DELETE" || r.Method == "PATCH" {
			writes++
		}
		// mutation: same template seen before but payload shape changed, and
		// it happened right after an error.
		if prev, ok := payloadByTemplate[r.Template]; ok {
			if prev != r.PayloadHash && r.PayloadHash != "" && r.AfterError {
				mutations++
			}
		}
		payloadByTemplate[r.Template] = r.PayloadHash
		if r.Baited {
			f.Baited = 1
		}
		_ = i
	}

	// Breadth is the distinct-template ratio (scale-free, timing-independent):
	// scanners hit a new path almost every request (ratio→1); humans revisit a
	// small set (ratio low). Using a ratio rather than a per-minute rate avoids
	// a burst of requests looking like enumeration purely because it was fast.
	// It is damped for very short windows where the ratio is not yet meaningful.
	distinctRatio := float64(len(templates)) / float64(len(w))
	if len(w) < 5 {
		distinctRatio *= float64(len(w)) / 5.0
	}
	f.Breadth = math.Min(distinctRatio, 1)
	f.NotFoundRatio = float64(notFound) / float64(len(w))
	f.ErrorSeek = float64(afterErr) / float64(len(w))
	f.MutationShare = float64(mutations) / float64(len(w))
	f.WriteRatio = float64(writes) / float64(len(w))

	if s.FP.Inconsistent {
		f.FPInconsistent = 1
	}
	return f
}

// regularity returns 1 for perfectly metronomic gaps, falling toward 0 as the
// coefficient of variation rises (humans are irregular). Scanners hit ~1.
func regularity(gaps []float64) float64 {
	if len(gaps) < 2 {
		return 0
	}
	mean := 0.0
	for _, g := range gaps {
		mean += g
	}
	mean /= float64(len(gaps))
	if mean == 0 {
		return 1 // all-zero gaps = a tight automated burst
	}
	var variance float64
	for _, g := range gaps {
		d := g - mean
		variance += d * d
	}
	variance /= float64(len(gaps))
	cv := math.Sqrt(variance) / mean
	// CV 0 → 1 ; CV 1 → ~0.37 ; CV 2 → ~0.14
	return math.Exp(-cv)
}

func median(xs []float64) float64 {
	c := append([]float64(nil), xs...)
	sort.Float64s(c)
	n := len(c)
	if n == 0 {
		return 0
	}
	if n%2 == 1 {
		return c[n/2]
	}
	return (c[n/2-1] + c[n/2]) / 2
}
