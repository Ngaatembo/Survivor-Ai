-- Real market-price research — replaces the old pure-formula price guess
-- (modeled monthly revenue / assumed engagement count) with actual going
-- rates found via live search. One per opportunity, regenerated
-- (upserted) as research improves. Additive only — safe to run against a
-- live, populated database.

CREATE TABLE IF NOT EXISTS market_price_research (
  id                  TEXT PRIMARY KEY,
  opportunity_id      TEXT NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  service             TEXT NOT NULL DEFAULT '',
  region              TEXT NOT NULL DEFAULT '',
  price_min           REAL NOT NULL DEFAULT 0,
  price_max           REAL NOT NULL DEFAULT 0,
  currency            TEXT NOT NULL DEFAULT 'USD',
  rationale           TEXT NOT NULL DEFAULT '',
  confidence          TEXT NOT NULL DEFAULT 'LOW' CHECK (confidence IN ('HIGH','MEDIUM','LOW')),
  generator           TEXT NOT NULL DEFAULT 'snippet-digest' CHECK (generator IN ('llm','snippet-digest')),
  sources             TEXT NOT NULL DEFAULT '[]',
  generated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_market_price_research_opportunity ON market_price_research(opportunity_id);

-- Run once only — not safe to re-run (SQLite errors on a duplicate
-- ADD COLUMN). Lets an offer explain WHY it's priced the way it is —
-- grounded in real market research, or the old formula estimate.
ALTER TABLE offers ADD COLUMN price_rationale TEXT;
