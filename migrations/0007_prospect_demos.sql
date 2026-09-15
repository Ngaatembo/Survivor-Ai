-- Phase 3 (deepened): a real, working single-page demo website built for
-- one specific prospect. One per offer, regenerated (upserted) as
-- research/offer details improve. Additive only — safe to run against a
-- live, populated database.

CREATE TABLE IF NOT EXISTS prospect_demos (
  id                    TEXT PRIMARY KEY,
  prospect_id           TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE CASCADE,
  offer_id              TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  business_name         TEXT NOT NULL DEFAULT '',
  html                  TEXT NOT NULL DEFAULT '',
  hero_headline         TEXT NOT NULL DEFAULT '',
  sections_included     TEXT NOT NULL DEFAULT '[]',
  generator             TEXT NOT NULL DEFAULT 'template' CHECK (generator IN ('llm','template')),
  generated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_demos_prospect ON prospect_demos(prospect_id);
CREATE INDEX IF NOT EXISTS idx_prospect_demos_offer ON prospect_demos(offer_id);
