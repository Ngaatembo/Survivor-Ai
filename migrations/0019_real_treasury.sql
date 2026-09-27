-- 0019_real_treasury.sql  (27 Sep 2026)
-- Splits the wallet ledger into the REAL treasury and the old SIMULATED
-- practice ledger. Every row that exists before this migration was written by
-- the simulation (simulated experiment budgets and simulated revenue), so it
-- is marked SIMULATED and no longer counts toward the balance. The engine
-- writes every new row with ledger = 'REAL': owner capital, actual AI/search
-- costs ("[AUTO]" expenses) and verified revenue.
ALTER TABLE transactions ADD COLUMN ledger TEXT NOT NULL DEFAULT 'SIMULATED' CHECK (ledger IN ('REAL','SIMULATED'));
CREATE INDEX IF NOT EXISTS idx_tx_agent_ledger_time ON transactions(agent_id, ledger, created_at);
