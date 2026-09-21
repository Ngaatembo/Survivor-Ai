-- Economic Survival Overhaul — generic key/value persistence for the search
-- budget/cache ledger (src/services/searchEconomy.ts). One small JSON blob
-- per key, scoped to the agent. Additive only (CREATE TABLE IF NOT EXISTS) —
-- safe to re-run against a live, populated database, same convention as
-- 0001-0004 and 0010.
--
-- Apply manually against production (same pattern documented in
-- worker/wrangler.toml's header comment for prior migrations):
--   npx wrangler d1 execute survivor-ai --file=./migrations/0011_search_economy.sql --remote
--
-- This migration is NOT wired into .github/workflows/deploy.yml — no
-- migration is (see DEPLOYMENT SAFETY audit notes in
-- docs/SURVIVAL_ECONOMICS_AUDIT.md). Deploys only run `wrangler deploy`;
-- schema changes are always a deliberate, manual, human-run command.

CREATE TABLE IF NOT EXISTS kv_store (
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL DEFAULT '{}',
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (agent_id, key)
);
