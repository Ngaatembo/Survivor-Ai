-- ============================================================================
-- Migration 0001 — add cycle concurrency lock to agents
-- ----------------------------------------------------------------------------
-- Fixes: overlapping cron ticks / manual /cycles/run calls could race and
-- run two cycles concurrently against the same agent, double-spending the
-- simulated balance. tryClaimCycle()/releaseCycleLock() in the repositories
-- use this column as an atomic compare-and-swap lock.
--
-- Safe to apply to an existing production database: additive only, nullable,
-- no data loss. Apply with:
--   npx wrangler d1 execute survivor-ai --file=./migrations/0001_add_cycle_lock.sql --remote
-- ============================================================================

ALTER TABLE agents ADD COLUMN cycle_lock_at TEXT;
