-- Sales & Client Acquisition System. Additive and idempotent: nothing existing is altered or dropped.
-- The worker also creates these lazily (ensureSalesTables), so applying this is optional.

CREATE TABLE IF NOT EXISTS sales_leads (
      prospect_id TEXT PRIMARY KEY REFERENCES prospects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      stage_entered_at INTEGER NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      contact_person TEXT, phone TEXT, whatsapp TEXT, email TEXT,
      angle TEXT, recommended_channel TEXT, offer_type TEXT,
      demo_status TEXT NOT NULL DEFAULT 'NONE',
      demo_sent_at INTEGER,
      selected_message_id TEXT,
      last_contact_at INTEGER,
      next_action TEXT, next_action_at INTEGER,
      lost_reason TEXT, lost_notes TEXT,
      won_value REAL, won_at INTEGER,
      brief_json TEXT, researched_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON sales_leads(stage);

CREATE TABLE IF NOT EXISTS sales_stages (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      from_stage TEXT, to_stage TEXT NOT NULL, note TEXT, at INTEGER NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_sales_stages_prospect ON sales_stages(prospect_id, at);

CREATE TABLE IF NOT EXISTS sales_activities (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_sales_activities_prospect ON sales_activities(prospect_id, created_at);

CREATE TABLE IF NOT EXISTS sales_messages (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, variant TEXT NOT NULL, channel TEXT, angle TEXT,
      body TEXT NOT NULL, edited_body TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT', sent_at INTEGER, created_at INTEGER NOT NULL
    );

CREATE INDEX IF NOT EXISTS idx_sales_messages_prospect ON sales_messages(prospect_id, created_at);

CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      due_at INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING', created_at INTEGER NOT NULL, done_at INTEGER
    );

CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(status, due_at);

CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      scheduled_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'CALL', notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SCHEDULED', created_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      offer_type TEXT NOT NULL, quote_json TEXT NOT NULL, scope_json TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      sent_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS sales_notes (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      body TEXT NOT NULL, created_at INTEGER NOT NULL
    );

CREATE TABLE IF NOT EXISTS sales_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS pricing_settings (key TEXT PRIMARY KEY, value REAL, updated_at INTEGER NOT NULL);
