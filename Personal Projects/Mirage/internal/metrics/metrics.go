// Package metrics implements just enough of the Prometheus text exposition
// format for Mirage's needs: a handful of counters/gauges and one latency
// histogram. Hand-rolled to avoid a large client-library dependency (see D3).
package metrics

import (
	"fmt"
	"io"
	"sort"
	"sync"
	"sync/atomic"
	"time"
)

// latencyBuckets are the added-latency histogram buckets in seconds.
var latencyBuckets = []float64{
	0.0005, 0.001, 0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1,
}

// Registry holds all Mirage metrics.
type Registry struct {
	mu       sync.Mutex
	counters map[string]*int64
	gauges   map[string]func() float64

	// latency histogram (added latency Mirage introduces)
	latCounts []int64
	latInf    int64
	latSum    int64 // microseconds
	latN      int64
}

// New creates a registry.
func New() *Registry {
	return &Registry{
		counters:  make(map[string]*int64),
		gauges:    make(map[string]func() float64),
		latCounts: make([]int64, len(latencyBuckets)),
	}
}

// Inc increments a named counter by 1.
func (r *Registry) Inc(name string) { r.Add(name, 1) }

// Add adds delta to a named counter.
func (r *Registry) Add(name string, delta int64) {
	r.mu.Lock()
	p := r.counters[name]
	if p == nil {
		p = new(int64)
		r.counters[name] = p
	}
	r.mu.Unlock()
	atomic.AddInt64(p, delta)
}

// Gauge registers a gauge backed by a live function.
func (r *Registry) Gauge(name string, fn func() float64) {
	r.mu.Lock()
	r.gauges[name] = fn
	r.mu.Unlock()
}

// ObserveLatency records an added-latency sample.
func (r *Registry) ObserveLatency(d time.Duration) {
	sec := d.Seconds()
	placed := false
	for i, b := range latencyBuckets {
		if sec <= b {
			atomic.AddInt64(&r.latCounts[i], 1)
			placed = true
			break
		}
	}
	if !placed {
		atomic.AddInt64(&r.latInf, 1)
	}
	atomic.AddInt64(&r.latSum, d.Microseconds())
	atomic.AddInt64(&r.latN, 1)
}

// WriteTo emits the metrics in Prometheus text format.
func (r *Registry) WriteTo(w io.Writer) {
	r.mu.Lock()
	type kv struct {
		k string
		p *int64
	}
	cs := make([]kv, 0, len(r.counters))
	for k, p := range r.counters {
		cs = append(cs, kv{k, p})
	}
	gs := make([]string, 0, len(r.gauges))
	for k := range r.gauges {
		gs = append(gs, k)
	}
	gfns := r.gauges
	r.mu.Unlock()

	sort.Slice(cs, func(i, j int) bool { return cs[i].k < cs[j].k })
	sort.Strings(gs)

	for _, c := range cs {
		fmt.Fprintf(w, "# TYPE %s counter\n%s %d\n", c.k, c.k, atomic.LoadInt64(c.p))
	}
	for _, g := range gs {
		fmt.Fprintf(w, "# TYPE %s gauge\n%s %g\n", g, g, gfns[g]())
	}

	// latency histogram
	fmt.Fprintf(w, "# TYPE mirage_added_latency_seconds histogram\n")
	var cum int64
	for i, b := range latencyBuckets {
		cum += atomic.LoadInt64(&r.latCounts[i])
		fmt.Fprintf(w, "mirage_added_latency_seconds_bucket{le=\"%g\"} %d\n", b, cum)
	}
	cum += atomic.LoadInt64(&r.latInf)
	fmt.Fprintf(w, "mirage_added_latency_seconds_bucket{le=\"+Inf\"} %d\n", cum)
	fmt.Fprintf(w, "mirage_added_latency_seconds_sum %g\n", float64(atomic.LoadInt64(&r.latSum))/1e6)
	fmt.Fprintf(w, "mirage_added_latency_seconds_count %d\n", atomic.LoadInt64(&r.latN))
}

// LatencyPercentiles returns approximate p50/p95/p99 added latency, computed
// from the histogram buckets, for the dashboard.
func (r *Registry) LatencyPercentiles() (p50, p95, p99 float64) {
	total := atomic.LoadInt64(&r.latN)
	if total == 0 {
		return 0, 0, 0
	}
	pick := func(q float64) float64 {
		target := int64(q * float64(total))
		var cum int64
		for i, b := range latencyBuckets {
			cum += atomic.LoadInt64(&r.latCounts[i])
			if cum >= target {
				return b * 1000 // ms
			}
		}
		return latencyBuckets[len(latencyBuckets)-1] * 1000
	}
	return pick(0.50), pick(0.95), pick(0.99)
}
