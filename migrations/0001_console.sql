-- Founder Console D1 schema (Workers Free / D1 Free).
-- Payload JSON remains the atomic source of truth; tables are query projections.

CREATE TABLE IF NOT EXISTS console_meta (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL,
  writer_id TEXT,
  writer_expires_at TEXT,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL,
  csrf TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  rotated_from TEXT
);

CREATE TABLE IF NOT EXISTS preferences (
  id TEXT PRIMARY KEY,
  visible INTEGER NOT NULL,
  sort_order INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  icon TEXT NOT NULL,
  description TEXT NOT NULL,
  confirm INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS decisions (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  subject_ref TEXT NOT NULL,
  status TEXT NOT NULL,
  notes TEXT NOT NULL,
  created_at TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audits (
  id TEXT PRIMARY KEY,
  at TEXT NOT NULL,
  actor TEXT NOT NULL,
  type TEXT NOT NULL,
  summary TEXT NOT NULL,
  correlation_id TEXT
);

CREATE TABLE IF NOT EXISTS evidence_cards (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  freshness TEXT NOT NULL,
  last_attempted_at TEXT NOT NULL,
  last_verified_at TEXT,
  evidence_ref TEXT,
  reason TEXT NOT NULL,
  next_setup_requirement TEXT NOT NULL,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS correlations (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  parent_action TEXT NOT NULL,
  event_ids TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  correlation_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  owner TEXT NOT NULL,
  executor TEXT NOT NULL,
  status TEXT NOT NULL,
  bounded_action TEXT NOT NULL,
  result_summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  external_id TEXT,
  run_id TEXT,
  model TEXT,
  payload TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS result_envelopes (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  correlation_id TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT NOT NULL,
  collected_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip TEXT PRIMARY KEY,
  attempts TEXT NOT NULL
);
