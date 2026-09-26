-- 0018_revenue_verifications.sql
-- Independent evidence for real-revenue ledger entries.
-- This table never creates revenue; it only records provider verification results.
CREATE TABLE IF NOT EXISTS revenue_verifications (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  revenue_entry_id TEXT NOT NULL,
  method TEXT NOT NULL,
  provider TEXT NOT NULL,
  external_reference TEXT NOT NULL,
  status TEXT NOT NULL,
  verified_amount REAL,
  currency TEXT,
  reason TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT '{}',
  checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_revenue_verifications_entry
  ON revenue_verifications(agent_id, revenue_entry_id, checked_at DESC);
