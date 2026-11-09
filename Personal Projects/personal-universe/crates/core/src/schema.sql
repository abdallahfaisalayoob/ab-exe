-- Personal Universe — schema v1. Everything lives in one local SQLite file.

CREATE TABLE collections (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  root_path TEXT NOT NULL UNIQUE,          -- folder path, or '::loose' / '::inbox'
  kind TEXT NOT NULL DEFAULT 'folder',     -- folder | loose | inbox
  watched INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_scan_at INTEGER
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  collection_id INTEGER NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  path TEXT NOT NULL UNIQUE,
  parent TEXT NOT NULL,
  name TEXT NOT NULL,
  ext TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'other',
  size INTEGER NOT NULL DEFAULT 0,
  mtime INTEGER NOT NULL DEFAULT 0,        -- unix ms
  ctime INTEGER NOT NULL DEFAULT 0,
  imported_at INTEGER NOT NULL,
  indexed_at INTEGER,
  opened_at INTEGER,
  hash TEXT,
  text_len INTEGER NOT NULL DEFAULT 0,
  excerpt TEXT NOT NULL DEFAULT '',
  meta TEXT NOT NULL DEFAULT '{}',
  missing INTEGER NOT NULL DEFAULT 0,
  favourite INTEGER NOT NULL DEFAULT 0,
  inbox_state TEXT                          -- NULL | 'new' | 'done'
);
CREATE INDEX files_collection ON files(collection_id);
CREATE INDEX files_parent ON files(parent);
CREATE INDEX files_hash ON files(hash);
CREATE INDEX files_mtime ON files(mtime);
CREATE INDEX files_kind ON files(kind);

CREATE VIRTUAL TABLE files_fts USING fts5(name, body, tokenize = 'unicode61 remove_diacritics 2');

CREATE TABLE file_terms (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  term TEXT NOT NULL,
  weight REAL NOT NULL,
  PRIMARY KEY (file_id, term)
) WITHOUT ROWID;
CREATE INDEX file_terms_term ON file_terms(term);

CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT);
CREATE TABLE file_tags (
  file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (file_id, tag_id)
) WITHOUT ROWID;

-- Universal links: anything can be connected to anything. Only user- or rule-established
-- relationships are stored here; nothing is inferred silently.
CREATE TABLE links (
  id INTEGER PRIMARY KEY,
  a_type TEXT NOT NULL, a_id INTEGER NOT NULL,
  b_type TEXT NOT NULL, b_id INTEGER NOT NULL,
  label TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (a_type, a_id, b_type, b_id)
);
CREATE INDEX links_b ON links(b_type, b_id);

CREATE TRIGGER files_ad AFTER DELETE ON files BEGIN
  DELETE FROM files_fts WHERE rowid = old.id;
  DELETE FROM links WHERE (a_type = 'file' AND a_id = old.id) OR (b_type = 'file' AND b_id = old.id);
END;

-- Academy
CREATE TABLE courses (
  id INTEGER PRIMARY KEY,
  code TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  instructor TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL DEFAULT '#8E9BFF',
  credits REAL,
  notes TEXT NOT NULL DEFAULT '',
  progress INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE class_slots (
  id INTEGER PRIMARY KEY,
  course_id INTEGER NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  day INTEGER NOT NULL,                     -- 0 = Monday … 6 = Sunday
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  room TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'Lecture',
  instructor TEXT NOT NULL DEFAULT ''
);
CREATE TABLE deadlines (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'assignment',  -- assignment|quiz|exam|presentation|lab|milestone|reminder|event
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  due_at TEXT NOT NULL,                     -- local 'YYYY-MM-DDTHH:MM'
  est_hours REAL NOT NULL DEFAULT 0,
  priority INTEGER NOT NULL DEFAULT 2,      -- 1 low · 2 normal · 3 high
  done INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX deadlines_due ON deadlines(due_at);
CREATE TABLE study_sessions (
  id INTEGER PRIMARY KEY,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  deadline_id INTEGER REFERENCES deadlines(id) ON DELETE SET NULL,
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE prompts (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT 'General',
  builtin INTEGER NOT NULL DEFAULT 0,
  uses INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

-- Finance. Amounts are stored in the account's own currency; nothing is converted at rest.
CREATE TABLE accounts (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'bank',        -- cash | bank | asset | liability
  currency TEXT NOT NULL DEFAULT 'PKR',
  opening_balance REAL NOT NULL DEFAULT 0,
  opened_on TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE transactions (
  id INTEGER PRIMARY KEY,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  amount REAL NOT NULL,                     -- signed: + in, − out
  category TEXT NOT NULL DEFAULT 'Uncategorised',
  payee TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  transfer_id INTEGER,                      -- pairs the two legs of a transfer
  recurring_id INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX tx_date ON transactions(date);
CREATE INDEX tx_account ON transactions(account_id);
CREATE TABLE budgets (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL UNIQUE,
  monthly_limit REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR'
);
CREATE TABLE goals (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'personal',    -- personal | savings
  target_amount REAL,
  saved_amount REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  due_date TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at INTEGER,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE recurring (
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  amount REAL NOT NULL,                     -- signed like transactions
  currency TEXT NOT NULL DEFAULT 'PKR',
  category TEXT NOT NULL DEFAULT 'Subscriptions',
  account_id INTEGER REFERENCES accounts(id) ON DELETE SET NULL,
  cadence TEXT NOT NULL DEFAULT 'monthly',  -- weekly | monthly | yearly
  next_date TEXT NOT NULL,
  is_subscription INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- Projects
CREATE TABLE projects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  objective TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',    -- active | paused | done
  color TEXT NOT NULL DEFAULT '#F2A65A',
  priority INTEGER NOT NULL DEFAULT 2,
  start_date TEXT,
  due_date TEXT,
  course_id INTEGER REFERENCES courses(id) ON DELETE SET NULL,
  team TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE milestones (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE tasks (
  id INTEGER PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'todo',      -- todo | doing | done
  priority INTEGER NOT NULL DEFAULT 2,
  due_date TEXT,
  assignee TEXT NOT NULL DEFAULT '',
  sort REAL NOT NULL DEFAULT 0,
  done_at INTEGER,
  created_at INTEGER NOT NULL
);

-- Notes attach to any owner (course, project, review, or free-standing captures).
CREATE TABLE notes (
  id INTEGER PRIMARY KEY,
  owner_type TEXT NOT NULL,
  owner_id INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX notes_owner ON notes(owner_type, owner_id);

-- The time machine reads from here. Written by the app itself, never sent anywhere.
CREATE TABLE activity (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  world TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  detail TEXT
);
CREATE INDEX activity_ts ON activity(ts);

-- Privacy ledger: every time material is prepared to leave this machine.
CREATE TABLE outbound_log (
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  target TEXT NOT NULL,
  summary TEXT NOT NULL,
  files TEXT NOT NULL DEFAULT '[]',
  dir TEXT
);

CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
