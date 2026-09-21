-- 0014_ecocash_payments.sql
-- EcoCash EIP payment intents + webhook event ledger.
-- Secrets are never stored here.

CREATE TABLE IF NOT EXISTS payment_intents (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  provider            TEXT NOT NULL DEFAULT 'ECOCASH',
  direction           TEXT NOT NULL DEFAULT 'INBOUND',
  amount              NUMERIC(12,2) NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'USD',
  description         TEXT NOT NULL DEFAULT '',
  end_user_id         TEXT NOT NULL,
  client_correlator   TEXT NOT NULL UNIQUE,
  reference_code      TEXT NOT NULL UNIQUE,
  external_id         TEXT,
  status              TEXT NOT NULL DEFAULT 'CREATED',
  notify_url          TEXT,
  provider_status     TEXT,
  provider_response   TEXT,
  created_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  confirmed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_intents_agent
  ON payment_intents(agent_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_external
  ON payment_intents(provider, external_id);

CREATE TABLE IF NOT EXISTS payment_provider_events (
  id                  TEXT PRIMARY KEY,
  provider            TEXT NOT NULL DEFAULT 'ECOCASH',
  external_event_id   TEXT NOT NULL UNIQUE,
  event_type          TEXT NOT NULL DEFAULT 'WEBHOOK',
  signature_verified  INTEGER NOT NULL DEFAULT 0,
  payload_hash        TEXT NOT NULL,
  payload_json        TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'RECEIVED',
  received_at         TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at        TEXT
);

CREATE INDEX IF NOT EXISTS idx_payment_events_provider_time
  ON payment_provider_events(provider, received_at DESC);
