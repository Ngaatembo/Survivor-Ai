-- 0024_revenue_loop.sql
-- Revenue-first loop: generic opportunities, the operator action queue, and a
-- transition log. Additive only. Nothing here moves money: revenue still only
-- enters the ledger through Treasury.confirmRevenue after provider verification.

CREATE TABLE IF NOT EXISTS survivor_opportunities (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL,
  run_id                TEXT,
  strategy_id           TEXT NOT NULL,
  source_ref            TEXT NOT NULL,            -- e.g. prospect id; unique per strategy
  title                 TEXT NOT NULL,
  target_customer       TEXT NOT NULL DEFAULT '',
  problem               TEXT NOT NULL DEFAULT '',
  offer                 TEXT NOT NULL DEFAULT '',
  hypothesis            TEXT NOT NULL DEFAULT '',
  success_criterion     TEXT NOT NULL DEFAULT '',
  estimated_value       REAL NOT NULL DEFAULT 0,  -- USD if it succeeds
  estimated_cost        REAL NOT NULL DEFAULT 0,  -- USD cash out of the treasury to test it
  prior_probability     REAL NOT NULL DEFAULT 0,  -- strategy's own estimate, 0..1
  probability           REAL NOT NULL DEFAULT 0,  -- calibrated against real outcomes, 0..1
  score                 REAL NOT NULL DEFAULT 0,
  score_explanation     TEXT NOT NULL DEFAULT '',
  evidence              TEXT NOT NULL DEFAULT '{}',
  status                TEXT NOT NULL DEFAULT 'DISCOVERED'
                          CHECK (status IN ('DISCOVERED','QUALIFIED','SELECTED','TESTING','ACTIVE','WON','LOST','ABANDONED')),
  status_reason         TEXT,
  revenue_entry_id      TEXT,                     -- ledger entry that proved WON
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL,
  UNIQUE (agent_id, strategy_id, source_ref)
);
CREATE INDEX IF NOT EXISTS idx_survivor_opportunities_status ON survivor_opportunities(agent_id, status, score DESC);

CREATE TABLE IF NOT EXISTS survivor_actions (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL,
  opportunity_id        TEXT NOT NULL REFERENCES survivor_opportunities(id),
  kind                  TEXT NOT NULL CHECK (kind IN ('CONTACT_PROSPECT','FOLLOW_UP','REQUEST_PAYMENT')),
  title                 TEXT NOT NULL,
  why                   TEXT NOT NULL DEFAULT '',
  instructions          TEXT NOT NULL DEFAULT '',
  payload               TEXT NOT NULL DEFAULT '{}',   -- message text, contact, wa.me link
  requires_human        INTEGER NOT NULL DEFAULT 1,
  expected_value        REAL NOT NULL DEFAULT 0,
  predicted_probability REAL NOT NULL DEFAULT 0,
  predicted_outcome     TEXT NOT NULL DEFAULT '',
  cost                  REAL NOT NULL DEFAULT 0,
  status                TEXT NOT NULL DEFAULT 'WAITING_FOR_OPERATOR'
                          CHECK (status IN ('WAITING_FOR_OPERATOR','APPROVED','REJECTED','COMPLETED','RESOLVED')),
  result                TEXT CHECK (result IS NULL OR result IN ('NO_RESPONSE','INTERESTED','PRICE_REJECTED','NEGOTIATING','TRIAL','PAID','LOST')),
  result_note           TEXT,
  payment_reference     TEXT,
  created_at            TEXT NOT NULL,
  decided_at            TEXT,
  completed_at          TEXT,
  resolved_at           TEXT,
  updated_at            TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_survivor_actions_status ON survivor_actions(agent_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_survivor_actions_opportunity ON survivor_actions(opportunity_id);
-- one open action per opportunity at a time
CREATE UNIQUE INDEX IF NOT EXISTS idx_survivor_actions_one_open
  ON survivor_actions(opportunity_id) WHERE status IN ('WAITING_FOR_OPERATOR','APPROVED','COMPLETED');

CREATE TABLE IF NOT EXISTS survivor_transitions (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL,
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('OPPORTUNITY','ACTION')),
  entity_id     TEXT NOT NULL,
  from_status   TEXT,
  to_status     TEXT NOT NULL,
  actor         TEXT NOT NULL,            -- 'survivor' | 'operator' | 'verifier:FINIVEX_PROVIDER'
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_survivor_transitions_entity ON survivor_transitions(entity_type, entity_id, created_at);
