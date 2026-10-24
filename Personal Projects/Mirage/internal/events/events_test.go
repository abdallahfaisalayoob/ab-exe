package events

import (
	"path/filepath"
	"testing"
	"time"
)

func testStores(t *testing.T) map[string]Store {
	t.Helper()
	sq, err := OpenSQLite("file:" + filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sq.Close() })
	return map[string]Store{"memory": NewMemory(100), "sqlite": sq}
}

func TestStoreAppendRecent(t *testing.T) {
	for name, s := range testStores(t) {
		t.Run(name, func(t *testing.T) {
			for i := 0; i < 5; i++ {
				_ = s.Append(Event{Kind: KindScore, SessionID: "s", Score: i * 10})
			}
			_ = s.Append(Event{Kind: KindTrip, SessionID: "attacker", Path: "/x"})

			// sqlite writes are async; allow the writer to drain.
			if name == "sqlite" {
				time.Sleep(150 * time.Millisecond)
			}

			recent, err := s.Recent(10)
			if err != nil {
				t.Fatal(err)
			}
			if len(recent) < 6 {
				t.Fatalf("%s: expected >=6 events, got %d", name, len(recent))
			}
			// newest first
			if recent[0].Kind != KindTrip {
				t.Errorf("%s: newest event should be the trip, got %s", name, recent[0].Kind)
			}

			trips, err := s.ByKind(KindTrip, 10)
			if err != nil {
				t.Fatal(err)
			}
			if len(trips) != 1 || trips[0].SessionID != "attacker" {
				t.Errorf("%s: ByKind(trip) wrong: %+v", name, trips)
			}
		})
	}
}
