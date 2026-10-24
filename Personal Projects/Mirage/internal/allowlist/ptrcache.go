package allowlist

import (
	"sync"
	"time"
)

// ptrCache memoises reverse-DNS verification results so a verified (or
// rejected) crawler IP isn't re-resolved on every request. Entries expire so a
// changed PTR/forward record is eventually re-checked.
type ptrCache struct {
	mu  sync.Mutex
	m   map[string]ptrEntry
	cap int
	ttl time.Duration
}

type ptrEntry struct {
	host string
	ok   bool
	at   time.Time
}

func newPTRCache(cap int) *ptrCache {
	return &ptrCache{m: make(map[string]ptrEntry), cap: cap, ttl: 15 * time.Minute}
}

func (c *ptrCache) get(ip string) (string, bool, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	e, ok := c.m[ip]
	if !ok || time.Since(e.at) > c.ttl {
		return "", false, false
	}
	return e.host, e.ok, true
}

func (c *ptrCache) put(ip, host string, ok bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.m) >= c.cap {
		// cheap eviction: drop one arbitrary entry
		for k := range c.m {
			delete(c.m, k)
			break
		}
	}
	c.m[ip] = ptrEntry{host: host, ok: ok, at: time.Now()}
}
