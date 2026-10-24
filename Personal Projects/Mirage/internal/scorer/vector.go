package scorer

// This file exposes the fixed feature order so training (cmd/mirage-sim train)
// can fit weights and map them back onto the named featureWeights fields. The
// order here MUST match the term order in LinModel.eval.

// featureOrder is the canonical ordering of weighted features.
var featureOrder = []string{
	"MedianGap", "ThinkBandShare", "GapRegularity", "Breadth",
	"NotFoundRatio", "ErrorSeek", "MutationShare", "FPInconsistent", "WriteRatio",
}

// FeatureNames returns the weighted-feature field names in canonical order.
func FeatureNames() []string {
	out := make([]string, len(featureOrder))
	copy(out, featureOrder)
	return out
}

// FeatureVector returns a Features value as an ordered slice matching
// FeatureNames.
func FeatureVector(f Features) []float64 {
	return []float64{
		f.MedianGap, f.ThinkBandShare, f.GapRegularity, f.Breadth,
		f.NotFoundRatio, f.ErrorSeek, f.MutationShare, f.FPInconsistent, f.WriteRatio,
	}
}

// ModelFromVector builds a LinModel from a bias and ordered weights.
func ModelFromVector(bias float64, w []float64) LinModel {
	m := LinModel{Bias: bias}
	if len(w) != len(featureOrder) {
		return m
	}
	m.Weights = featureWeights{
		MedianGap:      w[0],
		ThinkBandShare: w[1],
		GapRegularity:  w[2],
		Breadth:        w[3],
		NotFoundRatio:  w[4],
		ErrorSeek:      w[5],
		MutationShare:  w[6],
		FPInconsistent: w[7],
		WriteRatio:     w[8],
	}
	return m
}
