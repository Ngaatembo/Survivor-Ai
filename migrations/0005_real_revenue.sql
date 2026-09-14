-- Phase 4: real revenue (actual-money ledger, append-only), learning events
-- (append-only feedback feed), and real-world outcome tracking on delivery
-- projects. Additive only — safe to run against a live, populated database.

CREATE TABLE IF NOT EXISTS real_revenue (
  id                                TEXT PRIMARY KEY,
  date                              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  opportunity_id                    TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name                  TEXT NOT NULL DEFAULT '',
  prospect_id                       TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  prospect_name                     TEXT NOT NULL DEFAULT '',
  project_id                        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  product_service                   TEXT NOT NULL DEFAULT '',
  quoted_price                      REAL NOT NULL DEFAULT 0,
  amount_received                   REAL NOT NULL DEFAULT 0,
  costs                             REAL NOT NULL DEFAULT 0,
  profit                            REAL NOT NULL DEFAULT 0,
  currency                          TEXT NOT NULL DEFAULT 'USD',
  payment_method                    TEXT NOT NULL DEFAULT 'OTHER'
                                      CHECK (payment_method IN ('CASH','BANK_TRANSFER','MOBILE_MONEY','CARD','OTHER')),
  acquisition_channel               TEXT NOT NULL DEFAULT '',
  days_from_discovery_to_payment    INTEGER NOT NULL DEFAULT 0,
  notes                             TEXT,
  created_at                        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_real_revenue_opportunity ON real_revenue(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_real_revenue_project ON real_revenue(project_id);

CREATE TABLE IF NOT EXISTS learning_events (
  id                 TEXT PRIMARY KEY,
  kind               TEXT NOT NULL CHECK (kind IN ('REAL_REVENUE_RECORDED','PREDICTION_VS_ACTUAL')),
  opportunity_id     TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  category           TEXT NOT NULL,
  ref_id             TEXT NOT NULL,
  summary            TEXT NOT NULL,
  predicted_value    REAL,
  actual_value       REAL,
  delta_pct          REAL,
  created_at         TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_learning_events_opportunity ON learning_events(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_learning_events_category ON learning_events(category);

-- Real-world outcome tracking on delivery projects (§15) — nullable,
-- filled in by a human once known. SQLite has no ADD COLUMN IF NOT
-- EXISTS, so these three are guarded individually.
ALTER TABLE projects ADD COLUMN satisfaction INTEGER;
ALTER TABLE projects ADD COLUMN repeat_purchase INTEGER;
ALTER TABLE projects ADD COLUMN referral INTEGER;
