-- Real-world pipeline (build-spec: prospect schema/discovery/scoring, CRM,
-- AI outreach assistant). Additive only — safe to run against a live,
-- populated database.

ALTER TABLE agent_actions ADD COLUMN prospect_id TEXT;
ALTER TABLE agent_actions ADD COLUMN prospect_name TEXT;

CREATE TABLE IF NOT EXISTS prospects (
  id                          TEXT PRIMARY KEY,
  agent_id                    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id              TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name            TEXT NOT NULL DEFAULT '',
  business_name               TEXT NOT NULL,
  category                    TEXT NOT NULL DEFAULT '',
  location                    TEXT NOT NULL DEFAULT '',
  website_presence            TEXT NOT NULL DEFAULT 'UNKNOWN'
                                CHECK (website_presence IN ('NONE_FOUND','SOCIAL_ONLY','WEAK_OR_OUTDATED','ADEQUATE','UNKNOWN')),
  website_url                 TEXT,
  social_links                TEXT NOT NULL DEFAULT '[]',
  contact_channel              TEXT NOT NULL DEFAULT 'UNKNOWN'
                                CHECK (contact_channel IN ('PHONE','WHATSAPP','EMAIL','FACEBOOK','INSTAGRAM','WEBSITE_FORM','UNKNOWN')),
  contact_value                TEXT,
  evidence_notes                TEXT NOT NULL DEFAULT '',
  priority                    TEXT NOT NULL DEFAULT 'LOW'
                                CHECK (priority IN ('HIGH','MEDIUM','LOW','DO_NOT_CONTACT')),
  score                       TEXT NOT NULL DEFAULT '{}',
  status                      TEXT NOT NULL DEFAULT 'DISCOVERED'
                                CHECK (status IN ('DISCOVERED','QUALIFIED','CONTACTED','REPLIED','INTERESTED',
                                                   'PROPOSAL_SENT','NEGOTIATING','WON','LOST','NOT_INTERESTED','FOLLOW_UP')),
  data_source                 TEXT NOT NULL DEFAULT 'LIVE' CHECK (data_source IN ('SAMPLE','LIVE')),
  date_discovered              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_contact_at              TEXT,
  next_follow_up_at            TEXT,
  messages_sent_count          INTEGER NOT NULL DEFAULT 0,
  responses_received_count     INTEGER NOT NULL DEFAULT 0,
  actual_revenue                REAL NOT NULL DEFAULT 0,
  notes                        TEXT NOT NULL DEFAULT '[]',
  reason_lost                  TEXT,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospects_agent ON prospects(agent_id);
CREATE INDEX IF NOT EXISTS idx_prospects_opportunity ON prospects(opportunity_id);
CREATE INDEX IF NOT EXISTS idx_prospects_priority ON prospects(agent_id, priority);

CREATE TABLE IF NOT EXISTS prospect_sources (
  id            TEXT PRIMARY KEY,
  prospect_id   TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT,
  kind          TEXT NOT NULL,
  note          TEXT
);
CREATE INDEX IF NOT EXISTS idx_prospect_sources_prospect ON prospect_sources(prospect_id);

CREATE TABLE IF NOT EXISTS prospect_interactions (
  id            TEXT PRIMARY KEY,
  prospect_id   TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                 CHECK (kind IN ('DISCOVERED','QUALIFIED','OUTREACH_GENERATED','STATUS_CHANGE','NOTE','FOLLOW_UP_SET')),
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_prospect_interactions_prospect ON prospect_interactions(prospect_id, created_at DESC);

CREATE TABLE IF NOT EXISTS outreach_messages (
  id                     TEXT PRIMARY KEY,
  prospect_id            TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE CASCADE,
  opportunity_id         TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  business_model_id      TEXT,
  whatsapp               TEXT NOT NULL,
  sms                    TEXT NOT NULL,
  email                  TEXT NOT NULL DEFAULT '{}',
  short_version          TEXT NOT NULL,
  professional_version   TEXT NOT NULL,
  follow_up_1            TEXT NOT NULL,
  follow_up_2            TEXT NOT NULL,
  objection_responses    TEXT NOT NULL DEFAULT '[]',
  price_explanation      TEXT NOT NULL,
  call_script            TEXT NOT NULL DEFAULT '[]',
  meeting_agenda         TEXT NOT NULL DEFAULT '[]',
  proposal_outline       TEXT NOT NULL DEFAULT '[]',
  generator              TEXT NOT NULL DEFAULT 'local-rule-engine',
  generated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_outreach_prospect ON outreach_messages(prospect_id);
