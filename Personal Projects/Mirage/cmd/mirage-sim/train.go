package main

import (
	"flag"
	"fmt"
	"math"

	"github.com/abdallahfaisalayoob/mirage/internal/scorer"
	"github.com/abdallahfaisalayoob/mirage/internal/sim"
)

// runTrain fits two logistic-regression models (agent, hostile) on labelled
// simulator features by plain gradient descent, then prints weights ready to
// paste into internal/scorer/weights.go. The model stays a dot product, so its
// per-feature contributions remain the human-readable reasons.
func runTrain(args []string) {
	fs := flag.NewFlagSet("train", flag.ExitOnError)
	n := fs.Int("n", 1500, "sessions per profile")
	epochs := fs.Int("epochs", 400, "gradient-descent epochs")
	lr := fs.Float64("lr", 0.3, "learning rate")
	seed := fs.Int64("seed", 11, "rng seed")
	_ = fs.Parse(args)

	rng := newRNG(*seed)

	// Build the labelled dataset. featureVec order must match applyWeights.
	type row struct {
		x             []float64
		agentY, hostY float64
	}
	var rows []row
	add := func(p sim.Profile, ay, hy float64) {
		for i := 0; i < *n; i++ {
			f := scorer.Extract(sim.Gen(p, rng, i))
			rows = append(rows, row{x: scorer.FeatureVector(f), agentY: ay, hostY: hy})
		}
	}
	add(sim.Human, 0, 0)
	add(sim.Scanner, 1, 1)
	add(sim.Agent, 1, 1)

	dim := len(rows[0].x)
	agentW := make([]float64, dim)
	hostW := make([]float64, dim)
	var agentB, hostB float64

	train := func(w []float64, b *float64, label func(row) float64) {
		for e := 0; e < *epochs; e++ {
			gw := make([]float64, dim)
			var gb float64
			for _, r := range rows {
				z := *b
				for j := range w {
					z += w[j] * r.x[j]
				}
				p := 1 / (1 + math.Exp(-z))
				err := p - label(r)
				for j := range w {
					gw[j] += err * r.x[j]
				}
				gb += err
			}
			inv := *lr / float64(len(rows))
			for j := range w {
				w[j] -= inv * gw[j]
			}
			*b -= inv * gb
		}
	}
	train(agentW, &agentB, func(r row) float64 { return r.agentY })
	train(hostW, &hostB, func(r row) float64 { return r.hostY })

	names := scorer.FeatureNames()
	fmt.Printf("// trained on %d sessions/profile, %d epochs, lr=%.3g\n\n", *n, *epochs, *lr)
	printModel("AgentModel", agentB, agentW, names)
	printModel("HostileModel", hostB, hostW, names)

	// Report training accuracy as a sanity check.
	sc := scorer.NewWith(
		scorer.ModelFromVector(agentB, agentW), scorer.ModelFromVector(hostB, hostW))
	var humanFP, scanDet, agentDet, nH, nS, nA int
	rng2 := newRNG(*seed + 1)
	for i := 0; i < *n; i++ {
		if sc.Score(sim.Gen(sim.Human, rng2, i)).Score >= 82 {
			humanFP++
		}
		nH++
		if sc.Score(sim.Gen(sim.Scanner, rng2, i)).Score >= 60 {
			scanDet++
		}
		nS++
		if sc.Score(sim.Gen(sim.Agent, rng2, i)).Score >= 82 {
			agentDet++
		}
		nA++
	}
	fmt.Printf("\n// validation: humanFP=%.3f%% scannerDet=%.1f%% agentShadow=%.1f%%\n",
		100*float64(humanFP)/float64(nH),
		100*float64(scanDet)/float64(nS),
		100*float64(agentDet)/float64(nA))
}

func printModel(name string, bias float64, w []float64, names []string) {
	fmt.Printf("func %s() LinModel {\n\treturn LinModel{\n\t\tBias: %.4f,\n\t\tWeights: featureWeights{\n", name, bias)
	for j, nm := range names {
		fmt.Printf("\t\t\t%s: %.4f,\n", nm, w[j])
	}
	fmt.Printf("\t\t},\n\t}\n}\n\n")
}
