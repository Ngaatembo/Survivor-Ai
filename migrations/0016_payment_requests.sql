-- 0016_payment_requests.sql
-- Generic human-controlled client payment requests. This is a collection
-- ledger only; it never moves money and does not require a Finivex link.
CREATE TABLE IF NOT EXISTS payment_requests (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL,
  client_name TEXT NOT NULL,
  amount REAL NOT NULL,
  currency TEXT NOT NULL CHECK (currency IN ('USD','ZWG')),
  description TEXT NOT NULL,
  payment_method TEXT NOT NULL DEFAULT 'OTHER' CHECK (payment_method IN ('FINIVEX','ECOCASH','BANK','CASH','OTHER')),
  prospect_id TEXT,
  project_id TEXT,
  opportunity_id TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','LINK_CREATED','PAID','CANCELLED','FAILED')),
  finivex_link_id TEXT,
  finivex_reference TEXT,
  payment_link TEXT,
  created_at TEXT NOT NULL,
  approved_at TEXT,
  paid_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_payment_requests_status ON payment_requests(status);
CREATE INDEX IF NOT EXISTS idx_payment_requests_created_at ON payment_requests(created_at);
CREATE INDEX IF NOT EXISTS idx_payment_requests_finivex_reference ON payment_requests(finivex_reference);
