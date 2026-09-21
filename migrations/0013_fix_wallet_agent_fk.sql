-- Survivor 2.0 — fix D1 wallet ledger foreign-key bootstrap
-- The wallet is already scoped by agent_id in D1Repository. Removing the
-- agent FK avoids a D1 edge case observed when an agent row is reset/recreated
-- while preserving the optional experiment reference integrity.
PRAGMA foreign_keys = OFF;

CREATE TABLE transactions_new (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL,
  type                  TEXT NOT NULL CHECK (type IN ('DEPOSIT','REVENUE','EXPENSE','REFUND','PROFIT','LOSS')),
  amount                REAL NOT NULL,
  description           TEXT NOT NULL,
  related_experiment_id TEXT REFERENCES experiments(id),
  balance_after         REAL NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO transactions_new (
  id, agent_id, type, amount, description, related_experiment_id, balance_after, created_at
)
SELECT
  id, agent_id, type, amount, description, related_experiment_id, balance_after, created_at
FROM transactions;

DROP TABLE transactions;
ALTER TABLE transactions_new RENAME TO transactions;

CREATE INDEX idx_tx_agent_time ON transactions(agent_id, created_at);

PRAGMA foreign_keys = ON;
