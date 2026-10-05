-- 0022_truthful_ledger.sql  (4 Oct 2026)
-- Truthful economic ledger: explicit runs, typed + idempotent ledger entries,
-- terminal death, and quarantine of simulated memory.
--
-- What it does
--   1. survivor_runs: one row per experiment. Capital enters ONLY as the
--      run's single STARTING_CAPITAL entry. DEAD / ENDED are final.
--   2. transactions gains run_id, kind, idempotency_key, environment,
--      currency, recorded_by, metadata. Balance = SUM(amount) of a run.
--   3. Backfill: the existing REAL $50 opening deposit becomes run
--      run_<agent>_001 (PRODUCTION, ALIVE, death threshold $0). Any other
--      pre-0022 REAL rows stay in that run's balance, labelled
--      LEGACY_UNCLASSIFIED. SIMULATED rows are labelled LEGACY_SIMULATION and
--      remain outside every run.
--   4. agent_memory.provenance: every existing memory row came from
--      Math.random() experiments (production had 0 verified revenue and 0
--      learning events when this was written), so all are SIMULATED_LEGACY
--      and no longer drive decisions.
--   5. Triggers repeat the ledger rules in the database (see
--      src/economy/d1LedgerStore.ts).
--
-- Apply exactly once (SQLite has no ADD COLUMN IF NOT EXISTS), and BEFORE
-- deploying the code that reads these columns. Each trigger is kept on one
-- line so statement splitters that cut on ";\n" do not break its body.

CREATE TABLE IF NOT EXISTS survivor_runs (
  id                 TEXT PRIMARY KEY,
  agent_id           TEXT NOT NULL,
  environment        TEXT NOT NULL CHECK (environment IN ('PRODUCTION','SANDBOX','TEST')),
  status             TEXT NOT NULL CHECK (status IN ('CREATED','ALIVE','DEPLETED','DEAD','ENDED')),
  currency           TEXT NOT NULL DEFAULT 'USD',
  starting_capital   REAL NOT NULL CHECK (starting_capital > 0),
  death_threshold    REAL NOT NULL DEFAULT 0 CHECK (death_threshold >= 0),
  depleted_threshold REAL NOT NULL DEFAULT 0,
  label              TEXT,
  created_at         TEXT NOT NULL,
  started_at         TEXT,
  died_at            TEXT,
  ended_at           TEXT,
  end_reason         TEXT,
  created_by         TEXT NOT NULL DEFAULT 'operator',
  CHECK (death_threshold < starting_capital),
  CHECK (depleted_threshold >= death_threshold AND depleted_threshold < starting_capital)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_survivor_runs_one_open ON survivor_runs(agent_id) WHERE status IN ('CREATED','ALIVE','DEPLETED');
CREATE INDEX IF NOT EXISTS idx_survivor_runs_agent_time ON survivor_runs(agent_id, created_at);

ALTER TABLE transactions ADD COLUMN run_id TEXT REFERENCES survivor_runs(id);
ALTER TABLE transactions ADD COLUMN kind TEXT;
ALTER TABLE transactions ADD COLUMN idempotency_key TEXT;
ALTER TABLE transactions ADD COLUMN environment TEXT;
ALTER TABLE transactions ADD COLUMN currency TEXT;
ALTER TABLE transactions ADD COLUMN recorded_by TEXT;
ALTER TABLE transactions ADD COLUMN metadata TEXT NOT NULL DEFAULT '{}';

ALTER TABLE agent_memory ADD COLUMN provenance TEXT NOT NULL DEFAULT 'SIMULATED_LEGACY';

-- Backfill (before the immutability triggers exist) ---------------------------
INSERT INTO survivor_runs (id, agent_id, environment, status, currency, starting_capital, death_threshold, depleted_threshold, label, created_at, started_at, created_by)
SELECT 'run_' || t.agent_id || '_001', t.agent_id, 'PRODUCTION', 'ALIVE', 'USD', t.amount, 0, ROUND(t.amount * 0.1, 2),
       'First production run (migrated from the 0019 REAL treasury)', t.created_at, t.created_at, 'migration:0022'
FROM transactions t
WHERE t.id = 'tx-real-opening-deposit' AND t.ledger = 'REAL' AND t.amount > 0
  AND NOT EXISTS (SELECT 1 FROM survivor_runs r WHERE r.agent_id = t.agent_id);

UPDATE transactions
SET run_id = 'run_' || agent_id || '_001', kind = 'STARTING_CAPITAL',
    idempotency_key = 'run:run_' || agent_id || '_001:starting-capital',
    environment = 'PRODUCTION', currency = 'USD', recorded_by = 'migration:0022'
WHERE id = 'tx-real-opening-deposit' AND ledger = 'REAL'
  AND EXISTS (SELECT 1 FROM survivor_runs r WHERE r.id = 'run_' || transactions.agent_id || '_001');

UPDATE transactions
SET run_id = 'run_' || agent_id || '_001', kind = 'LEGACY_UNCLASSIFIED', idempotency_key = 'legacy:' || id,
    environment = 'PRODUCTION', currency = 'USD', recorded_by = 'migration:0022'
WHERE ledger = 'REAL' AND run_id IS NULL
  AND EXISTS (SELECT 1 FROM survivor_runs r WHERE r.id = 'run_' || transactions.agent_id || '_001');

UPDATE transactions SET kind = 'LEGACY_SIMULATION', environment = 'SIMULATED' WHERE ledger = 'SIMULATED' AND kind IS NULL;

-- Indexes ------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_idempotency_key ON transactions(idempotency_key);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tx_one_starting_capital ON transactions(run_id) WHERE kind = 'STARTING_CAPITAL';
CREATE INDEX IF NOT EXISTS idx_tx_run_time ON transactions(run_id, created_at);

-- Database-level guards -----------------------------------------------------------
CREATE TRIGGER IF NOT EXISTS trg_tx_real_requires_run BEFORE INSERT ON transactions WHEN NEW.ledger = 'REAL' AND NEW.run_id IS NULL BEGIN SELECT RAISE(ABORT, 'ledger: REAL entries must belong to a survivor run'); END;
CREATE TRIGGER IF NOT EXISTS trg_tx_requires_kind_and_key BEFORE INSERT ON transactions WHEN NEW.run_id IS NOT NULL AND (NEW.kind IS NULL OR NEW.idempotency_key IS NULL) BEGIN SELECT RAISE(ABORT, 'ledger: kind and idempotency_key are required'); END;
CREATE TRIGGER IF NOT EXISTS trg_tx_run_must_be_open BEFORE INSERT ON transactions WHEN NEW.run_id IS NOT NULL AND COALESCE((SELECT status FROM survivor_runs WHERE id = NEW.run_id), 'MISSING') NOT IN ('CREATED','ALIVE','DEPLETED') BEGIN SELECT RAISE(ABORT, 'ledger: run is not open'); END;
CREATE TRIGGER IF NOT EXISTS trg_tx_capital_only_on_new_run BEFORE INSERT ON transactions WHEN NEW.kind = 'STARTING_CAPITAL' AND (SELECT status FROM survivor_runs WHERE id = NEW.run_id) <> 'CREATED' BEGIN SELECT RAISE(ABORT, 'ledger: starting capital is only accepted by a newly created run'); END;
CREATE TRIGGER IF NOT EXISTS trg_tx_no_legacy_kinds BEFORE INSERT ON transactions WHEN NEW.kind IN ('LEGACY_SIMULATION','LEGACY_UNCLASSIFIED','TRANSFER_IN') BEGIN SELECT RAISE(ABORT, 'ledger: this kind cannot be written'); END;
CREATE TRIGGER IF NOT EXISTS trg_tx_immutable_update BEFORE UPDATE ON transactions WHEN OLD.run_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'ledger: entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_tx_immutable_delete BEFORE DELETE ON transactions WHEN OLD.run_id IS NOT NULL BEGIN SELECT RAISE(ABORT, 'ledger: entries are immutable'); END;
CREATE TRIGGER IF NOT EXISTS trg_run_terminal_is_final BEFORE UPDATE OF status ON survivor_runs WHEN OLD.status IN ('DEAD','ENDED') AND NEW.status <> OLD.status BEGIN SELECT RAISE(ABORT, 'survivor run: DEAD and ENDED are final'); END;
CREATE TRIGGER IF NOT EXISTS trg_run_terms_fixed BEFORE UPDATE OF starting_capital, death_threshold, depleted_threshold, environment, currency, agent_id ON survivor_runs BEGIN SELECT RAISE(ABORT, 'survivor run: capital, thresholds, environment and currency are fixed at creation'); END;
CREATE TRIGGER IF NOT EXISTS trg_run_no_delete BEFORE DELETE ON survivor_runs BEGIN SELECT RAISE(ABORT, 'survivor run: runs are never deleted'); END;
