// Command mirage-sim is the traffic simulator and scorer-evaluation harness.
//
// Subcommands:
//
//	offline  generate labelled sessions for all three profiles, score them
//	         with Mirage's scorer, and report detection rate, human false
//	         positives, and per-score latency. (No network; fast and
//	         deterministic — this is what milestones are validated against.)
//	run      drive real HTTP traffic through a live Mirage proxy and summarise
//	         the response rungs observed per profile.
//	train    fit logistic-regression weights on simulated features and print
//	         them in a form ready to paste into internal/scorer/weights.go.
//
// It produces the SHAPE of attacks only — never working exploit code.
package main

import (
	"fmt"
	"math/rand"
	"os"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	switch os.Args[1] {
	case "offline":
		runOffline(os.Args[2:])
	case "run":
		runLive(os.Args[2:])
	case "train":
		runTrain(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
}

func usage() {
	fmt.Fprintln(os.Stderr, "usage: mirage-sim <offline|run|train> [flags]")
}

func newRNG(seed int64) *rand.Rand { return rand.New(rand.NewSource(seed)) }
