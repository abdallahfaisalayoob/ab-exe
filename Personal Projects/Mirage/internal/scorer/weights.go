package scorer

// Built-in, hand-tuned model weights. These are the transparent starting point
// (DECISIONS.md D4). `mirage-sim train` can regenerate this file by fitting
// logistic regression on labelled simulator traffic; the hand-tuned values are
// chosen so a fresh build already separates the three simulator profiles with
// near-zero false positives on humans.
//
// Scoring intuition:
//   - AGENT rises with fast/regular timing, LLM think-time pauses, and
//     fingerprint inconsistency.
//   - HOSTILE rises with enumeration breadth, 404 ratio, error-seeking, and
//     payload mutation.
//   - The combined score multiplies the two, so a client must look BOTH
//     automated AND hostile to score high — this is what protects humans who
//     merely browse quickly.

// AgentModel returns the agent-likeness model.
func AgentModel() LinModel {
	return LinModel{
		Bias: -2.5,
		Weights: featureWeights{
			MedianGap:      3.0, // short intervals
			ThinkBandShare: 1.5, // LLM pauses (weak alone; humans pause too)
			GapRegularity:  3.0, // metronomic = scripted
			Breadth:        0.5,
			WriteRatio:     1.0,
			FPInconsistent: 2.0,
		},
	}
}

// HostileModel returns the hostility model.
func HostileModel() LinModel {
	return LinModel{
		Bias: -3.5,
		Weights: featureWeights{
			// Breadth alone (distinct paths that all return 200) is normal
			// browsing, so it is weighted modestly; hostility is driven by
			// MISSING (404) and ERROR-seeking enumeration and payload mutation.
			Breadth:       1.6,
			NotFoundRatio: 4.0,
			ErrorSeek:     2.5,
			MutationShare: 4.0,
		},
	}
}
