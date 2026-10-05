-- 0021_prospect_problem_persistence.sql  (4 Oct 2026)
-- ProspectIntelligence.primaryProblem and .problemSelection were never stored
-- in D1: D1Repository wrote neither field, so after any reload the sales
-- evidence gate (src/sales/intelligence.ts problemEvidenceAllowed) saw no
-- problem and blocked every lead from READY_TO_CONTACT, offers and outreach.
-- Additive, nullable JSON columns; existing rows read back as "no problem
-- selected", which is what the gate already assumed.
-- SQLite has no ADD COLUMN IF NOT EXISTS: apply this migration exactly once.
ALTER TABLE prospect_intelligence ADD COLUMN primary_problem TEXT;
ALTER TABLE prospect_intelligence ADD COLUMN problem_selection TEXT;
