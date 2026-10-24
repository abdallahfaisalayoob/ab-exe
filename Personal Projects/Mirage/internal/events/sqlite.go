package events

import (
	"database/sql"
	"time"

	_ "modernc.org/sqlite" // pure-Go driver → static binary (no cgo)
)

// SQLite is the default durable event store.
type SQLite struct {
	db     *sql.DB
	writes chan Event
	done   chan struct{}
}

// OpenSQLite opens (and migrates) a SQLite event store. Writes are async via a
// buffered channel so the request path never blocks on disk I/O.
func OpenSQLite(dsn string) (*SQLite, error) {
	if dsn == "" {
		dsn = "file:mirage.db?cache=shared"
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1) // sqlite: serialise writes
	if _, err := db.Exec(schema); err != nil {
		db.Close()
		return nil, err
	}
	s := &SQLite{db: db, writes: make(chan Event, 1024), done: make(chan struct{})}
	go s.loop()
	return s, nil
}

const schema = `
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at INTEGER NOT NULL,
  kind TEXT NOT NULL,
  session_id TEXT,
  ip TEXT,
  fp TEXT,
  path TEXT,
  score INTEGER,
  agent INTEGER,
  hostile INTEGER,
  rung TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind, id DESC);
`

func (s *SQLite) loop() {
	for {
		select {
		case <-s.done:
			return
		case e := <-s.writes:
			_, _ = s.db.Exec(
				`INSERT INTO events(at,kind,session_id,ip,fp,path,score,agent,hostile,rung,detail)
				 VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
				e.At.UnixNano(), string(e.Kind), e.SessionID, e.IP, e.FP, e.Path,
				e.Score, e.Agent, e.Hostile, e.Rung, e.Detail)
		}
	}
}

// Append enqueues an event (non-blocking; drops under extreme backpressure so
// the data path is never stalled — fail open applies to logging too).
func (s *SQLite) Append(e Event) error {
	if e.At.IsZero() {
		e.At = time.Now()
	}
	select {
	case s.writes <- e:
	default:
		// queue full: drop rather than block the request path
	}
	return nil
}

func (s *SQLite) Recent(limit int) ([]Event, error) {
	return s.query(`SELECT id,at,kind,session_id,ip,fp,path,score,agent,hostile,rung,detail
	                FROM events ORDER BY id DESC LIMIT ?`, limit)
}

func (s *SQLite) ByKind(k Kind, limit int) ([]Event, error) {
	return s.query(`SELECT id,at,kind,session_id,ip,fp,path,score,agent,hostile,rung,detail
	                FROM events WHERE kind=? ORDER BY id DESC LIMIT ?`, string(k), limit)
}

func (s *SQLite) query(q string, args ...any) ([]Event, error) {
	rows, err := s.db.Query(q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Event
	for rows.Next() {
		var e Event
		var atNs int64
		var kind string
		if err := rows.Scan(&e.ID, &atNs, &kind, &e.SessionID, &e.IP, &e.FP,
			&e.Path, &e.Score, &e.Agent, &e.Hostile, &e.Rung, &e.Detail); err != nil {
			return out, err
		}
		e.At = time.Unix(0, atNs)
		e.Kind = Kind(kind)
		out = append(out, e)
	}
	return out, rows.Err()
}

func (s *SQLite) Close() error {
	close(s.done)
	return s.db.Close()
}
