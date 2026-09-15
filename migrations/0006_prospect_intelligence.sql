-- Phase 6: prospect intelligence (deep, business-specific research). One
-- report per prospect, regenerated (upserted) as new research runs.
-- Additive only — safe to run against a live, populated database.

CREATE TABLE IF NOT EXISTS prospect_intelligence (
  id                            TEXT PRIMARY KEY,
  prospect_id                   TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE CASCADE,
  business_overview             TEXT NOT NULL DEFAULT '',
  apparent_services             TEXT NOT NULL DEFAULT '[]',
  social_presence_summary       TEXT NOT NULL DEFAULT '',
  competitive_note              TEXT NOT NULL DEFAULT '',
  specific_problem_evidence     TEXT NOT NULL DEFAULT '',
  recommended_angle             TEXT NOT NULL DEFAULT '',
  confidence                    TEXT NOT NULL DEFAULT 'LOW' CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  generator                     TEXT NOT NULL DEFAULT 'snippet-digest' CHECK (generator IN ('llm','snippet-digest')),
  sources                       TEXT NOT NULL DEFAULT '[]',
  generated_at                  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_intelligence_prospect ON prospect_intelligence(prospect_id);
