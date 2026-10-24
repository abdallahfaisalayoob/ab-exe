package main

import (
	"flag"
	"fmt"
	"os"
	"sort"
	"text/tabwriter"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/scorer"
	"github.com/abdallahfaisalayoob/mirage/internal/sim"
)

func runOffline(args []string) {
	fs := flag.NewFlagSet("offline", flag.ExitOnError)
	n := fs.Int("n", 500, "sessions per profile")
	seed := fs.Int64("seed", 7, "rng seed")
	shadowT := fs.Int("shadow", 82, "shadow threshold")
	powT := fs.Int("pow", 55, "pow/monitor-escalation threshold")
	_ = fs.Parse(args)

	sc := scorer.New()
	rng := newRNG(*seed)

	type stat struct {
		count                         int
		scoreSum                      int
		atOrAboveShadow, atOrAbovePoW int
		scores                        []int
		latencies                     []time.Duration
	}
	stats := map[sim.Profile]*stat{sim.Human: {}, sim.Scanner: {}, sim.Agent: {}}

	for _, p := range []sim.Profile{sim.Human, sim.Scanner, sim.Agent} {
		st := stats[p]
		for i := 0; i < *n; i++ {
			s := sim.Gen(p, rng, i)
			t0 := time.Now()
			res := sc.Score(s)
			lat := time.Since(t0)
			st.count++
			st.scoreSum += res.Score
			st.scores = append(st.scores, res.Score)
			st.latencies = append(st.latencies, lat)
			if res.Score >= *shadowT {
				st.atOrAboveShadow++
			}
			if res.Score >= *powT {
				st.atOrAbovePoW++
			}
		}
	}

	fmt.Printf("Mirage simulator — offline scorer evaluation\n")
	fmt.Printf("sessions/profile=%d  seed=%d  shadow>=%d  escalate>=%d\n\n", *n, *seed, *shadowT, *powT)

	tw := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)
	fmt.Fprintln(tw, "profile\tavg\tp50\tescalate%\tshadow%\tscore p95 latency")
	for _, p := range []sim.Profile{sim.Human, sim.Scanner, sim.Agent} {
		st := stats[p]
		avg := float64(st.scoreSum) / float64(st.count)
		fmt.Fprintf(tw, "%s\t%.1f\t%d\t%.1f\t%.1f\t%v\n",
			p, avg, pctile(st.scores, 50),
			100*float64(st.atOrAbovePoW)/float64(st.count),
			100*float64(st.atOrAboveShadow)/float64(st.count),
			latP95(st.latencies))
	}
	tw.Flush()

	humanFP := 100 * float64(stats[sim.Human].atOrAboveShadow) / float64(stats[sim.Human].count)
	fmt.Printf("\nHuman false-positive (shadowed) rate: %.3f%%\n", humanFP)
	fmt.Printf("Scanner detection (escalated) rate:   %.1f%%\n",
		100*float64(stats[sim.Scanner].atOrAbovePoW)/float64(stats[sim.Scanner].count))
	fmt.Printf("Agent shadow rate:                    %.1f%%\n",
		100*float64(stats[sim.Agent].atOrAboveShadow)/float64(stats[sim.Agent].count))

	if humanFP > 0 {
		fmt.Printf("\nFAIL: human false positives present\n")
		os.Exit(1)
	}
	fmt.Printf("\nPASS: zero human false positives\n")
}

func pctile(xs []int, q int) int {
	if len(xs) == 0 {
		return 0
	}
	c := append([]int(nil), xs...)
	sort.Ints(c)
	idx := q * len(c) / 100
	if idx >= len(c) {
		idx = len(c) - 1
	}
	return c[idx]
}

func latP95(xs []time.Duration) time.Duration {
	if len(xs) == 0 {
		return 0
	}
	c := append([]time.Duration(nil), xs...)
	sort.Slice(c, func(i, j int) bool { return c[i] < c[j] })
	idx := 95 * len(c) / 100
	if idx >= len(c) {
		idx = len(c) - 1
	}
	return c[idx]
}
