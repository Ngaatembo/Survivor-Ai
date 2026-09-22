-- 0015_finivex_payment_links.sql
-- Human-approved Finivex payment-link ledger. Secrets never enter D1.
CREATE TABLE IF NOT EXISTS finivex_payment_links (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  transaction_id TEXT NOT NULL UNIQUE,
  provider_reference TEXT,
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD','ZWG')),
  description TEXT NOT NULL,
  customer_email TEXT,
  customer_phone TEXT,
  payment_link TEXT,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAID','EXPIRED','CANCELLED','FAILED','UNKNOWN')),
  provider_response TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  paid_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_finivex_payment_links_status ON finivex_payment_links(status);
CREATE INDEX IF NOT EXISTS idx_finivex_payment_links_created_at ON finivex_payment_links(created_at);
