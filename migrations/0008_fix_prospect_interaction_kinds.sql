-- Fix: prospect_interactions.kind's CHECK constraint was never updated
-- when OFFER_DRAFTED/PROJECT_STARTED (Phase 3) and INTELLIGENCE_GATHERED
-- (Phase 6) and DEMO_BUILT (Phase 3, deepened) were added to the app's
-- ProspectInteractionKind type -- every attempt to log one of those kinds
-- has been silently failing with SQLITE_CONSTRAINT. SQLite can't ALTER a
-- CHECK constraint directly, so this safely rebuilds the table, preserving
-- all existing rows. Run this ONCE — it is NOT safe to re-run (the second
-- run will fail at the RENAME step since the table is already fixed).

ALTER TABLE prospect_interactions RENAME TO prospect_interactions_old_0008;

CREATE TABLE prospect_interactions (
  id            TEXT PRIMARY KEY,
  prospect_id   TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                 CHECK (kind IN ('DISCOVERED','QUALIFIED','OUTREACH_GENERATED','STATUS_CHANGE','NOTE','FOLLOW_UP_SET','OFFER_DRAFTED','PROJECT_STARTED','INTELLIGENCE_GATHERED','DEMO_BUILT')),
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO prospect_interactions SELECT * FROM prospect_interactions_old_0008;

DROP TABLE prospect_interactions_old_0008;

CREATE INDEX IF NOT EXISTS idx_prospect_interactions_prospect ON prospect_interactions(prospect_id, created_at DESC);

