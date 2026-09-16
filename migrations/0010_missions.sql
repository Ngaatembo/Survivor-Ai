-- Survivor 2.0 §10: the structured mission ladder, replacing the freeform
-- Agent.currentObjective string. Small, fixed-size table (5 steps),
-- fully replaced each cycle as missions complete/activate. Additive
-- only — safe to run against a live, populated database.

CREATE TABLE IF NOT EXISTS missions (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  sequence            INTEGER NOT NULL,
  objective           TEXT NOT NULL DEFAULT '',
  target_balance      REAL NOT NULL DEFAULT 0,
  strategy            TEXT NOT NULL DEFAULT '',
  status              TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','COMPLETED','FAILED')),
  expected_revenue    TEXT,
  started_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at        TEXT,
  lessons_learned     TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_missions_agent ON missions(agent_id, sequence);
