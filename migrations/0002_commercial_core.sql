-- Commercial core (build-spec: business model generator, opportunity
-- lifecycle, KILL/ITERATE/SCALE decisions, recommended actions).
-- Additive only — safe to run against a live, populated database.

ALTER TABLE opportunities ADD COLUMN lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERED';

CREATE TABLE IF NOT EXISTS opportunity_models (
  id                                TEXT PRIMARY KEY,
  agent_id                          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id                    TEXT NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name                  TEXT NOT NULL DEFAULT '',
  target_customer                   TEXT NOT NULL,
  problem                           TEXT NOT NULL,
  offer                             TEXT NOT NULL,
  why_they_buy                      TEXT NOT NULL,
  suggested_price                   REAL NOT NULL,
  price_rationale                   TEXT NOT NULL,
  delivery_cost_estimate            REAL NOT NULL,
  expected_gross_margin_pct         REAL NOT NULL,
  acquisition_channel               TEXT NOT NULL,
  sales_message                     TEXT NOT NULL,
  follow_up_sequence                TEXT NOT NULL DEFAULT '[]',
  objection_handling                TEXT NOT NULL DEFAULT '[]',
  delivery_workflow                 TEXT NOT NULL,
  time_to_first_sale_days_estimate  INTEGER NOT NULL,
  upsells                           TEXT NOT NULL DEFAULT '[]',
  recurring_revenue_note            TEXT NOT NULL DEFAULT '',
  expected_profit_first_deal        REAL NOT NULL,
  can_scale                         INTEGER NOT NULL DEFAULT 0,
  scale_note                        TEXT NOT NULL DEFAULT '',
  next_action                       TEXT NOT NULL DEFAULT '',
  confidence                        REAL NOT NULL DEFAULT 0,
  generator                         TEXT NOT NULL DEFAULT 'local-rule-engine',
  generated_at                      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_models_agent ON opportunity_models(agent_id);

CREATE TABLE IF NOT EXISTS opportunity_decisions (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id    TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name  TEXT NOT NULL DEFAULT '',
  action            TEXT NOT NULL CHECK (action IN ('KILL','ITERATE','SCALE','CONTINUE')),
  previous_state    TEXT NOT NULL,
  new_state         TEXT NOT NULL,
  reasoning         TEXT NOT NULL,
  evidence_summary  TEXT NOT NULL,
  metrics           TEXT NOT NULL DEFAULT '{}',
  next_action       TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_decisions_agent_time ON opportunity_decisions(agent_id, created_at DESC);

CREATE TABLE IF NOT EXISTS agent_actions (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  opportunity_id    TEXT REFERENCES opportunities(id),
  opportunity_name  TEXT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  expected_value    REAL NOT NULL DEFAULT 0,
  urgency           INTEGER NOT NULL DEFAULT 1,
  effort            INTEGER NOT NULL DEFAULT 1,
  rank              INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_actions_agent_rank ON agent_actions(agent_id, rank);
