package main

import (
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"strings"
	"time"

	"github.com/abdallahfaisalayoob/mirage/internal/sim"
)

// runLive drives real HTTP traffic through a running Mirage proxy. Each
// simulated session uses its own cookie jar so Mirage tracks it as one client.
// It reports, per profile, the share of requests that got a non-origin
// (challenged/shadowed/blocked) response, plus observed end-to-end latency.
//
// This path exercises the full stack; the deterministic validation lives in
// `offline`.
func runLive(args []string) {
	fs := flag.NewFlagSet("run", flag.ExitOnError)
	target := fs.String("target", "http://127.0.0.1:8080", "Mirage proxy base URL")
	n := fs.Int("n", 20, "sessions per profile")
	seed := fs.Int64("seed", 7, "rng seed")
	speed := fs.Float64("speed", 25, "time-compression factor for replayed think-time gaps")
	capMS := fs.Int("cap-ms", 400, "max replayed gap in ms (keeps the run quick)")
	_ = fs.Parse(args)

	rng := newRNG(*seed)
	fmt.Printf("Driving traffic at %s (%d sessions/profile)\n\n", *target, *n)

	for _, p := range []sim.Profile{sim.Human, sim.Scanner, sim.Agent} {
		var reqs, flagged int
		var latSum time.Duration
		for i := 0; i < *n; i++ {
			s := sim.Gen(p, rng, i)
			jar, _ := cookiejar.New(nil)
			client := &http.Client{Jar: jar, Timeout: 10 * time.Second}
			win := s.Window()
			for j, rs := range win {
				// Replay the recorded think-time gap, time-compressed, so the
				// scorer sees realistic RELATIVE cadence (its regularity feature
				// is scale-invariant). Keeps the run quick via the cap.
				if j > 0 {
					gap := rs.At.Sub(win[j-1].At).Seconds() / *speed
					d := time.Duration(gap * float64(time.Second))
					if d > time.Duration(*capMS)*time.Millisecond {
						d = time.Duration(*capMS) * time.Millisecond
					}
					if d > 0 {
						time.Sleep(d)
					}
				}
				url := *target + rs.RawPath
				var body io.Reader
				if rs.Method == "POST" {
					body = strings.NewReader("field=" + rs.PayloadHash)
				}
				req, err := http.NewRequest(rs.Method, url, body)
				if err != nil {
					continue
				}
				setProfileHeaders(req, p)
				t0 := time.Now()
				resp, err := client.Do(req)
				if err != nil {
					continue
				}
				latSum += time.Since(t0)
				io.Copy(io.Discard, resp.Body)
				resp.Body.Close()
				reqs++
				// A challenge/tarpit/shadow/block marks itself via a header
				// Mirage sets (added in M4), or via a non-2xx on a path the
				// origin would normally serve.
				if resp.Header.Get("X-Mirage-Rung") != "" &&
					resp.Header.Get("X-Mirage-Rung") != "monitor" {
					flagged++
				}
			}
		}
		avg := time.Duration(0)
		if reqs > 0 {
			avg = latSum / time.Duration(reqs)
		}
		fmt.Printf("%-8s requests=%-5d flagged=%-5d (%.1f%%)  avg-latency=%v\n",
			p, reqs, flagged, 100*float64(flagged)/float64(max1(reqs)), avg)
	}
}

func setProfileHeaders(req *http.Request, p sim.Profile) {
	switch p {
	case sim.Human:
		req.Header.Set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0")
		req.Header.Set("Accept", "text/html,application/xhtml+xml")
		req.Header.Set("Accept-Language", "en-US,en;q=0.9")
		req.Header.Set("Accept-Encoding", "gzip, deflate, br")
	case sim.Scanner:
		req.Header.Set("User-Agent", "python-requests/2.31.0")
	case sim.Agent:
		// Spoofs a browser UA while omitting the headers a browser always sends.
		req.Header.Set("User-Agent", "Mozilla/5.0 (compatible; Chrome/130.0)")
	}
}

func max1(n int) int {
	if n < 1 {
		return 1
	}
	return n
}
