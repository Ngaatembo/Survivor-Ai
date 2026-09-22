-- Survivor production D1 core-table completion.
-- The original full schema is not idempotent and is intentionally not run on every deploy.
-- These four core tables were absent from production D1; create them additively.
-- All statements are idempotent so a rerun is safe.

CREATE TABLE IF NOT EXISTS agent_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('SYSTEM','CYCLE','DISCOVERY','RESEARCH','VERIFY','SCORE',
                                 'DECISION','REJECTION','EXPERIMENT','WALLET','MEMORY','WARNING')),
  message     TEXT NOT NULL,
  data        TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agent_memory (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('opportunity','category','lesson','assumption')),
  ref_type      TEXT,
  ref_id        TEXT,
  title         TEXT NOT NULL,
  tests         INTEGER NOT NULL DEFAULT 0,
  spent         REAL NOT NULL DEFAULT 0,
  revenue      REAL NOT NULL DEFAULT 0,
  conclusion    TEXT NOT NULL DEFAULT 'UNTESTED'
                  CHECK (conclusion IN ('PROMISING','VIABLE','MIXED','AVOID','UNTESTED','WATCH')),
  notes         TEXT NOT NULL DEFAULT '[]',
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE IF NOT EXISTS agent_cycles (
  id                       TEXT PRIMARY KEY,
  agent_id                 TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  cycle_index              INTEGER NOT NULL,
  steps                    TEXT NOT NULL DEFAULT '[]',
  discovered_ids           TEXT NOT NULL DEFAULT '[]',
  selected_opportunity_id  TEXT REFERENCES opportunities(id),
  experiment_id            TEXT REFERENCES experiments(id),
  summary                  TEXT,
  started_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at             TEXT
);

CREATE TABLE IF NOT EXISTS research_reports (
  id                     TEXT PRIMARY KEY,
  agent_id               TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id         TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name       TEXT NOT NULL DEFAULT '',
  generator              TEXT NOT NULL DEFAULT 'local-rule-engine',
  executive_summary      TEXT NOT NULL,
  market_opportunity     TEXT,
  how_it_works           TEXT,
  capital_requirements   TEXT,
  competition            TEXT,
  risks                  TEXT NOT NULL DEFAULT '[]',
  evidence               TEXT,
  potential_revenue      TEXT,
  recommended_experiment TEXT,
  confidence             REAL NOT NULL,
  final_score            INTEGER NOT NULL,
  data_source            TEXT NOT NULL DEFAULT 'SAMPLE' CHECK (data_source IN ('SAMPLE','LIVE')),
  created_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
