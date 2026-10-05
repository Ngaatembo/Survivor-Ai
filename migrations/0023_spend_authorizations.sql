-- 0023_spend_authorizations.sql  (5 Oct 2026 — Tavily spend incident)
-- Every paid provider call (Tavily, Brave, LLM) must hold an authorization
-- row BEFORE the request is sent. The row is created by ONE atomic
-- INSERT ... SELECT ... WHERE statement (src/economy/spendGate.ts) that checks,
-- in the database at the same instant:
--   kill switch off, run ALIVE/DEPLETED, per-call cap, per-cycle cap,
--   per-channel daily cap, and runway (balance minus unsettled reservations
--   minus this call must stay at or above the run's floor).
-- D1 executes writes one at a time, so concurrent requests cannot both pass
-- a limit that only one of them fits under.
--
-- status: RESERVED  authorized; counts against every limit
--         SETTLED   provider answered; actual cost posted to the ledger
--         RELEASED  provider definitely did not bill (e.g. HTTP 4xx refusal)
-- A call whose outcome is uncertain (timeout, network error) stays RESERVED
-- and keeps counting against limits: never under-count possible spend.
-- Apply exactly once.

CREATE TABLE IF NOT EXISTS spend_authorizations (
  id               TEXT PRIMARY KEY,
  agent_id         TEXT NOT NULL,
  run_id           TEXT NOT NULL REFERENCES survivor_runs(id),
  idempotency_key  TEXT NOT NULL UNIQUE,
  initiated_by     TEXT NOT NULL CHECK (initiated_by IN ('SURVIVOR','OPERATOR')),
  channel          TEXT NOT NULL CHECK (channel IN ('AUTO','MANUAL')),
  provider         TEXT NOT NULL,
  operation        TEXT NOT NULL,
  units            REAL NOT NULL DEFAULT 1,
  unit             TEXT NOT NULL DEFAULT 'request',
  amount_reserved  REAL NOT NULL CHECK (amount_reserved > 0),
  amount_actual    REAL,
  day              TEXT NOT NULL,
  session_id       TEXT NOT NULL,
  reason           TEXT NOT NULL,
  status           TEXT NOT NULL CHECK (status IN ('RESERVED','SETTLED','RELEASED')),
  ledger_entry_id  TEXT,
  outcome          TEXT,
  created_at       TEXT NOT NULL,
  settled_at       TEXT
);
CREATE INDEX IF NOT EXISTS idx_spend_auth_day ON spend_authorizations(agent_id, channel, day, status);
CREATE INDEX IF NOT EXISTS idx_spend_auth_session ON spend_authorizations(session_id, status);
CREATE INDEX IF NOT EXISTS idx_spend_auth_run ON spend_authorizations(run_id, status);

-- An authorization can only move forward: RESERVED → SETTLED | RELEASED.
CREATE TRIGGER IF NOT EXISTS trg_spend_auth_forward_only BEFORE UPDATE OF status ON spend_authorizations WHEN OLD.status <> 'RESERVED' AND NEW.status <> OLD.status BEGIN SELECT RAISE(ABORT, 'spend authorization: status is final'); END;
CREATE TRIGGER IF NOT EXISTS trg_spend_auth_amount_fixed BEFORE UPDATE OF amount_reserved, provider, channel, run_id ON spend_authorizations BEGIN SELECT RAISE(ABORT, 'spend authorization: terms are fixed'); END;
CREATE TRIGGER IF NOT EXISTS trg_spend_auth_no_delete BEFORE DELETE ON spend_authorizations BEGIN SELECT RAISE(ABORT, 'spend authorization: rows are never deleted'); END;
