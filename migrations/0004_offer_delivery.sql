-- Phase 3: offer + delivery (offer generation, design briefs, project
-- tracking, CRM status write path). Additive only — safe to run against a
-- live, populated database.

CREATE TABLE IF NOT EXISTS offers (
  id                          TEXT PRIMARY KEY,
  prospect_id                 TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE CASCADE,
  prospect_name               TEXT NOT NULL DEFAULT '',
  opportunity_id               TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name             TEXT NOT NULL DEFAULT '',
  business_model_id            TEXT,
  price                       REAL NOT NULL DEFAULT 0,
  timeline_days_min            INTEGER NOT NULL DEFAULT 0,
  timeline_days_max            INTEGER NOT NULL DEFAULT 0,
  deliverables                TEXT NOT NULL DEFAULT '[]',
  gap_analysis                 TEXT,
  website_brief                TEXT NOT NULL DEFAULT '{}',
  status                      TEXT NOT NULL DEFAULT 'DRAFT'
                                CHECK (status IN ('DRAFT','SENT','ACCEPTED','DECLINED')),
  generator                   TEXT NOT NULL DEFAULT 'local-rule-engine',
  generated_at                 TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_offers_prospect ON offers(prospect_id);
CREATE INDEX IF NOT EXISTS idx_offers_opportunity ON offers(opportunity_id);

CREATE TABLE IF NOT EXISTS design_briefs (
  id                     TEXT PRIMARY KEY,
  offer_id               TEXT NOT NULL UNIQUE REFERENCES offers(id) ON DELETE CASCADE,
  prospect_id            TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  homepage_concept       TEXT NOT NULL DEFAULT '',
  hero_section           TEXT NOT NULL DEFAULT '',
  logo_direction         TEXT NOT NULL DEFAULT '',
  social_graphics        TEXT NOT NULL DEFAULT '[]',
  color_direction_note   TEXT NOT NULL DEFAULT '',
  asset_status           TEXT NOT NULL DEFAULT 'NOT_CONFIGURED'
                          CHECK (asset_status IN ('NOT_CONFIGURED','GENERATING','READY')),
  generated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_design_briefs_prospect ON design_briefs(prospect_id);

CREATE TABLE IF NOT EXISTS projects (
  id                          TEXT PRIMARY KEY,
  prospect_id                 TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE CASCADE,
  prospect_name               TEXT NOT NULL DEFAULT '',
  offer_id                    TEXT NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  opportunity_id               TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  agreed_price                 REAL NOT NULL DEFAULT 0,
  agreed_timeline_days_max      INTEGER NOT NULL DEFAULT 0,
  milestones                  TEXT NOT NULL DEFAULT '[]',
  status                      TEXT NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE','DELIVERED','CANCELLED')),
  started_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  delivered_at                 TEXT,
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_prospect ON projects(prospect_id);
CREATE INDEX IF NOT EXISTS idx_projects_opportunity ON projects(opportunity_id);
