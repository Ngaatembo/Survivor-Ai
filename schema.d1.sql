-- ============================================================================
-- SURVIVE AI — Cloudflare D1 (SQLite) schema
-- ----------------------------------------------------------------------------
-- SQLite translation of supabase/schema.sql. Differences from the Postgres
-- version, all driven by SQLite's type system:
--   * enums              -> TEXT + CHECK (col IN (...))
--   * text[]              -> TEXT holding a JSON array, e.g. '["a","b"]'
--   * jsonb               -> TEXT holding a JSON object
--   * numeric(12,2)       -> REAL (money is SIMULATED; no need for exact decimal)
--   * boolean              -> INTEGER 0/1 (SQLite has no native boolean)
--   * timestamptz          -> TEXT, ISO 8601 (e.g. '2026-09-10T12:00:00.000Z')
--   * Row Level Security   -> dropped; D1 has no RLS. The worker holds the only
--                             credentials (the D1 binding), so access control
--                             is enforced at the Worker/API layer instead.
-- Apply with:
--   npx wrangler d1 execute survivor-ai --file=./schema.d1.sql --remote
-- ============================================================================

PRAGMA foreign_keys = ON;

-- agents -----------------------------------------------------------------

CREATE TABLE agents (
  id                  TEXT PRIMARY KEY,
  name                TEXT NOT NULL DEFAULT 'SURVIVE-01',
  status              TEXT NOT NULL DEFAULT 'ALIVE'
                        CHECK (status IN ('ALIVE','AT_RISK','DEAD','RESEARCHING','EXECUTING','PAUSED')),
  starting_capital    REAL NOT NULL DEFAULT 50.00,
  survival_threshold  REAL NOT NULL DEFAULT 5.00,
  current_strategy    TEXT,
  current_objective   TEXT,
  cycle_count         INTEGER NOT NULL DEFAULT 0,
  total_cycles_run    INTEGER NOT NULL DEFAULT 0,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- hard safety switch: when 0, no real-money capability may ever execute
  real_money_enabled  INTEGER NOT NULL DEFAULT 0,
  daily_spend_limit   REAL NOT NULL DEFAULT 0.00,
  -- cycle concurrency lock: set when a cycle claims the right to run, cleared
  -- on release; a lock older than the engine's staleAfterMs can be reclaimed
  -- so a crashed run never permanently wedges the agent. NULL = not locked.
  cycle_lock_at       TEXT
);

-- opportunities ------------------------------------------------------------

CREATE TABLE opportunities (
  id                          TEXT PRIMARY KEY,
  agent_id                    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name                        TEXT NOT NULL,
  category                    TEXT NOT NULL
                                CHECK (category IN ('Digital Business','Content','E-Commerce','Services','Finance','Local / Real-World')),
  tags                        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  data_source                 TEXT NOT NULL DEFAULT 'SAMPLE' CHECK (data_source IN ('SAMPLE','LIVE')),
  research_stage              TEXT NOT NULL DEFAULT 'UNDISCOVERED'
                                CHECK (research_stage IN ('UNDISCOVERED','DISCOVERED','RESEARCHED','VERIFIED','SCORED','RANKED')),
  description                 TEXT NOT NULL,
  how_money_made              TEXT NOT NULL,
  capital_required_min        REAL NOT NULL DEFAULT 0,
  capital_required_max        REAL NOT NULL DEFAULT 0,
  time_to_revenue_days_min    INTEGER NOT NULL,
  time_to_revenue_days_max    INTEGER NOT NULL,
  skills                      TEXT NOT NULL DEFAULT '[]',   -- JSON array
  difficulty                  INTEGER NOT NULL CHECK (difficulty BETWEEN 1 AND 5),
  competition                 INTEGER NOT NULL CHECK (competition BETWEEN 1 AND 5),
  scalability                 INTEGER NOT NULL CHECK (scalability BETWEEN 1 AND 5),
  risk                        INTEGER NOT NULL CHECK (risk BETWEEN 1 AND 5),
  geographic_relevance        TEXT NOT NULL DEFAULT '[]',   -- JSON array
  evidence_tier                TEXT NOT NULL CHECK (evidence_tier IN ('VERIFIED','LIKELY','UNCERTAIN','UNVERIFIED')),
  evidence_notes               TEXT,
  success_probability          REAL NOT NULL CHECK (success_probability BETWEEN 0 AND 1),
  revenue_potential_monthly_min REAL NOT NULL,
  revenue_potential_monthly_max REAL NOT NULL,
  upside_note                  TEXT,
  downside_note                 TEXT,
  operating_costs_note          TEXT,
  examples                      TEXT NOT NULL DEFAULT '[]', -- JSON array
  execution_blocked             INTEGER NOT NULL DEFAULT 0,
  block_reason                   TEXT,
  score_total                    INTEGER CHECK (score_total BETWEEN 0 AND 100),
  score_recommendation           TEXT CHECK (score_recommendation IN ('HIGH PRIORITY','RECOMMENDED','WATCHLIST','DEPRIORITIZE','RESEARCH ONLY')),
  score_factors                   TEXT NOT NULL DEFAULT '{}', -- JSON object; full 9-factor breakdown
  date_researched                  TEXT,
  created_at                       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- Commercial-core lifecycle (build-spec §4) — evidence-driven, never
  -- flipped to PROVEN/SCALING off one lucky result. See decisionEngine.ts.
  lifecycle_state                TEXT NOT NULL DEFAULT 'DISCOVERED'
                                    CHECK (lifecycle_state IN ('DISCOVERED','VALIDATING','PROVEN','SCALING','FAILED','ARCHIVED'))
);
CREATE INDEX idx_opp_agent_stage ON opportunities(agent_id, research_stage);
CREATE INDEX idx_opp_score ON opportunities(agent_id, score_total DESC);

-- research_sources -----------------------------------------------------------

CREATE TABLE research_sources (
  id                TEXT PRIMARY KEY,
  opportunity_id    TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  url               TEXT,
  kind              TEXT NOT NULL, -- platform | report | community | academic | sample-note | web
  note              TEXT,
  verified          INTEGER NOT NULL DEFAULT 0,
  retrieved_at      TEXT
);
CREATE INDEX idx_sources_opportunity ON research_sources(opportunity_id);

-- research_reports -----------------------------------------------------------

CREATE TABLE research_reports (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id        TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name      TEXT NOT NULL DEFAULT '',
  generator             TEXT NOT NULL DEFAULT 'local-rule-engine',
  executive_summary     TEXT NOT NULL,
  market_opportunity    TEXT,
  how_it_works          TEXT,
  capital_requirements  TEXT,
  competition           TEXT,
  risks                 TEXT NOT NULL DEFAULT '[]', -- JSON array
  evidence              TEXT,
  potential_revenue     TEXT,
  recommended_experiment TEXT,
  confidence            REAL NOT NULL,
  final_score           INTEGER NOT NULL,
  data_source           TEXT NOT NULL DEFAULT 'SAMPLE' CHECK (data_source IN ('SAMPLE','LIVE')),
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_reports_agent_time ON research_reports(agent_id, created_at DESC);

-- experiments + results --------------------------------------------------------

CREATE TABLE experiments (
  id                  TEXT PRIMARY KEY,
  agent_id            TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  cycle_id            TEXT REFERENCES agent_cycles(id),
  opportunity_id      TEXT NOT NULL REFERENCES opportunities(id),
  opportunity_name    TEXT NOT NULL DEFAULT '',
  category            TEXT NOT NULL DEFAULT 'Services'
                        CHECK (category IN ('Digital Business','Content','E-Commerce','Services','Finance','Local / Real-World')),
  objective           TEXT NOT NULL,
  starting_budget     REAL NOT NULL,
  planned_action      TEXT NOT NULL,
  expected_outcome    TEXT,
  simulated           INTEGER NOT NULL DEFAULT 1,
  status              TEXT NOT NULL DEFAULT 'PLANNED', -- PLANNED | RUNNING | COMPLETE
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_experiments_agent_time ON experiments(agent_id, created_at DESC);

CREATE TABLE experiment_results (
  id                  TEXT PRIMARY KEY,
  experiment_id       TEXT NOT NULL UNIQUE REFERENCES experiments(id) ON DELETE CASCADE,
  outcome             TEXT NOT NULL CHECK (outcome IN ('SUCCESS','PARTIAL_SUCCESS','FAILED','INCONCLUSIVE')),
  actual_cost         REAL NOT NULL,
  actual_revenue      REAL NOT NULL,
  profit_loss         REAL NOT NULL,
  roi_pct             REAL NOT NULL,
  duration_days       INTEGER,
  lessons_learned     TEXT NOT NULL DEFAULT '[]', -- JSON array
  evidence_note       TEXT,
  raw_simulation      TEXT, -- JSON object: probability, roll, parameters
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- agent_memory ---------------------------------------------------------------

CREATE TABLE agent_memory (
  id            TEXT PRIMARY KEY,
  agent_id      TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL CHECK (kind IN ('opportunity','category','lesson','assumption')),
  ref_type      TEXT,          -- 'opportunity' | 'category'
  ref_id        TEXT,          -- opportunity id or category name
  title         TEXT NOT NULL,
  tests         INTEGER NOT NULL DEFAULT 0,
  spent         REAL NOT NULL DEFAULT 0,
  revenue       REAL NOT NULL DEFAULT 0,
  conclusion    TEXT NOT NULL DEFAULT 'UNTESTED'
                  CHECK (conclusion IN ('PROMISING','VIABLE','MIXED','AVOID','UNTESTED','WATCH')),
  notes         TEXT NOT NULL DEFAULT '[]', -- JSON array
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_memory_agent ON agent_memory(agent_id, kind);

-- transactions (append-only ledger) -------------------------------------------

CREATE TABLE transactions (
  id                    TEXT PRIMARY KEY,
  agent_id              TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type                  TEXT NOT NULL CHECK (type IN ('DEPOSIT','REVENUE','EXPENSE','REFUND','PROFIT','LOSS')),
  amount                REAL NOT NULL,   -- signed: + in, - out
  description           TEXT NOT NULL,
  related_experiment_id TEXT REFERENCES experiments(id),
  balance_after         REAL NOT NULL,   -- denormalized checkpoint
  created_at            TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
-- Balance is always derived: SUM(amount). The ledger is append-only.
CREATE INDEX idx_tx_agent_time ON transactions(agent_id, created_at);

-- agent_events -----------------------------------------------------------------

CREATE TABLE agent_events (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('SYSTEM','CYCLE','DISCOVERY','RESEARCH','VERIFY','SCORE',
                                 'DECISION','REJECTION','EXPERIMENT','WALLET','MEMORY','WARNING')),
  message     TEXT NOT NULL,
  data        TEXT, -- JSON object
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_events_agent_time ON agent_events(agent_id, created_at DESC);

-- strategies ---------------------------------------------------------------------

CREATE TABLE strategies (
  id          TEXT PRIMARY KEY,
  agent_id    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rationale   TEXT,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_strategies_agent_time ON strategies(agent_id, created_at DESC);

-- agent_cycles ---------------------------------------------------------------------

CREATE TABLE agent_cycles (
  id                       TEXT PRIMARY KEY,
  agent_id                 TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  cycle_index              INTEGER NOT NULL,
  steps                    TEXT NOT NULL DEFAULT '[]',  -- JSON array: per-step status/timestamps
  discovered_ids           TEXT NOT NULL DEFAULT '[]',  -- JSON array
  selected_opportunity_id  TEXT REFERENCES opportunities(id),
  experiment_id            TEXT REFERENCES experiments(id),
  summary                  TEXT,
  started_at               TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at              TEXT
);
CREATE INDEX idx_cycles_agent_time ON agent_cycles(agent_id, started_at);

-- opportunity_models ---------------------------------------------------------
-- Commercial core (build-spec §3): the concrete, sellable business model
-- behind a promising opportunity. One row per opportunity; regenerated
-- (upserted, keyed on opportunity_id) as evidence improves.

CREATE TABLE opportunity_models (
  id                                TEXT PRIMARY KEY,
  agent_id                          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id                    TEXT NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name                  TEXT NOT NULL DEFAULT '',
  target_customer                   TEXT NOT NULL,
  problem                           TEXT NOT NULL,
  offer                             TEXT NOT NULL,
  why_they_buy                      TEXT NOT NULL,
  suggested_price                   REAL NOT NULL,
  price_rationale                   TEXT NOT NULL,
  delivery_cost_estimate            REAL NOT NULL,
  expected_gross_margin_pct         REAL NOT NULL,
  acquisition_channel               TEXT NOT NULL,
  sales_message                     TEXT NOT NULL,
  follow_up_sequence                TEXT NOT NULL DEFAULT '[]', -- JSON array
  objection_handling                TEXT NOT NULL DEFAULT '[]', -- JSON array of {objection,response}
  delivery_workflow                 TEXT NOT NULL,
  time_to_first_sale_days_estimate  INTEGER NOT NULL,
  upsells                           TEXT NOT NULL DEFAULT '[]', -- JSON array
  recurring_revenue_note            TEXT NOT NULL DEFAULT '',
  expected_profit_first_deal        REAL NOT NULL,
  can_scale                         INTEGER NOT NULL DEFAULT 0,
  scale_note                        TEXT NOT NULL DEFAULT '',
  next_action                       TEXT NOT NULL DEFAULT '',
  confidence                        REAL NOT NULL DEFAULT 0,
  generator                         TEXT NOT NULL DEFAULT 'local-rule-engine',
  generated_at                      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_models_agent ON opportunity_models(agent_id);

-- opportunity_decisions --------------------------------------------------------
-- Commercial core (build-spec §5): append-only KILL/ITERATE/SCALE/CONTINUE
-- audit log. Every entry explains WHY (reasoning) and WHAT NEXT (next_action).

CREATE TABLE opportunity_decisions (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id    TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name  TEXT NOT NULL DEFAULT '',
  action            TEXT NOT NULL CHECK (action IN ('KILL','ITERATE','SCALE','CONTINUE')),
  previous_state    TEXT NOT NULL,
  new_state         TEXT NOT NULL,
  reasoning         TEXT NOT NULL,
  evidence_summary  TEXT NOT NULL,
  metrics           TEXT NOT NULL DEFAULT '{}', -- JSON: {tests, spent, revenue, realRevenueScore}
  next_action       TEXT NOT NULL DEFAULT '',
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_decisions_agent_time ON opportunity_decisions(agent_id, created_at DESC);

-- agent_actions ----------------------------------------------------------------
-- Commercial core (build-spec §16): "what should I do now?" — derived,
-- ranked recommendations. Fully replaced every cycle (not accumulated);
-- history of what was recommended lives implicitly in opportunity_decisions.

CREATE TABLE agent_actions (
  id                TEXT PRIMARY KEY,
  agent_id          TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  kind              TEXT NOT NULL,
  opportunity_id    TEXT REFERENCES opportunities(id),
  opportunity_name  TEXT,
  prospect_id       TEXT,
  prospect_name     TEXT,
  title             TEXT NOT NULL,
  description       TEXT NOT NULL,
  expected_value    REAL NOT NULL DEFAULT 0,
  urgency           INTEGER NOT NULL DEFAULT 1,
  effort            INTEGER NOT NULL DEFAULT 1,
  rank              INTEGER NOT NULL DEFAULT 1,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_actions_agent_rank ON agent_actions(agent_id, rank);

-- prospects ---------------------------------------------------------------------
-- Real-world pipeline (build-spec §7/§8): local businesses discovered as
-- candidates for a validated opportunity's business model. Always traces
-- back to an opportunity — this is real-world execution, not a parallel
-- simulation. website_presence defaults to UNKNOWN and is only set to a
-- stronger claim when the cited source actually supports it.

CREATE TABLE prospects (
  id                          TEXT PRIMARY KEY,
  agent_id                    TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
  opportunity_id              TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  opportunity_name            TEXT NOT NULL DEFAULT '',
  business_name               TEXT NOT NULL,
  category                    TEXT NOT NULL DEFAULT '',
  location                    TEXT NOT NULL DEFAULT '',
  website_presence            TEXT NOT NULL DEFAULT 'UNKNOWN'
                                CHECK (website_presence IN ('NONE_FOUND','SOCIAL_ONLY','WEAK_OR_OUTDATED','ADEQUATE','UNKNOWN')),
  website_url                 TEXT,
  social_links                TEXT NOT NULL DEFAULT '[]', -- JSON array
  contact_channel              TEXT NOT NULL DEFAULT 'UNKNOWN'
                                CHECK (contact_channel IN ('PHONE','WHATSAPP','EMAIL','FACEBOOK','INSTAGRAM','WEBSITE_FORM','UNKNOWN')),
  contact_value               TEXT,
  evidence_notes               TEXT NOT NULL DEFAULT '',
  priority                    TEXT NOT NULL DEFAULT 'LOW'
                                CHECK (priority IN ('HIGH','MEDIUM','LOW','DO_NOT_CONTACT')),
  score                       TEXT NOT NULL DEFAULT '{}', -- JSON LeadScoreBreakdown
  status                      TEXT NOT NULL DEFAULT 'DISCOVERED'
                                CHECK (status IN ('DISCOVERED','QUALIFIED','CONTACTED','REPLIED','INTERESTED',
                                                   'PROPOSAL_SENT','NEGOTIATING','WON','LOST','NOT_INTERESTED','FOLLOW_UP')),
  data_source                 TEXT NOT NULL DEFAULT 'LIVE' CHECK (data_source IN ('SAMPLE','LIVE')),
  date_discovered              TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_contact_at              TEXT,
  next_follow_up_at            TEXT,
  messages_sent_count          INTEGER NOT NULL DEFAULT 0,
  responses_received_count     INTEGER NOT NULL DEFAULT 0,
  actual_revenue               REAL NOT NULL DEFAULT 0,
  notes                        TEXT NOT NULL DEFAULT '[]', -- JSON array
  reason_lost                  TEXT,
  created_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at                   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_prospects_agent ON prospects(agent_id);
CREATE INDEX idx_prospects_opportunity ON prospects(opportunity_id);
CREATE INDEX idx_prospects_priority ON prospects(agent_id, priority);

CREATE TABLE prospect_sources (
  id            TEXT PRIMARY KEY,
  prospect_id   TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  url           TEXT,
  kind          TEXT NOT NULL,
  note          TEXT
);
CREATE INDEX idx_prospect_sources_prospect ON prospect_sources(prospect_id);

-- prospect_interactions ---------------------------------------------------------
-- Append-only observability trail (build-spec §23) for a prospect.

CREATE TABLE prospect_interactions (
  id            TEXT PRIMARY KEY,
  prospect_id   TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL
                 CHECK (kind IN ('DISCOVERED','QUALIFIED','OUTREACH_GENERATED','STATUS_CHANGE','NOTE','FOLLOW_UP_SET')),
  summary       TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_prospect_interactions_prospect ON prospect_interactions(prospect_id, created_at DESC);

-- outreach_messages ---------------------------------------------------------------
-- AI outreach assistant output (build-spec §9). One row per prospect;
-- regenerated (upserted) as the linked business model improves. Prepared
-- for human approval/execution — never sent automatically by this system.

CREATE TABLE outreach_messages (
  id                     TEXT PRIMARY KEY,
  prospect_id            TEXT NOT NULL UNIQUE REFERENCES prospects(id) ON DELETE CASCADE,
  opportunity_id         TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  business_model_id      TEXT,
  whatsapp               TEXT NOT NULL,
  sms                    TEXT NOT NULL,
  email                  TEXT NOT NULL DEFAULT '{}', -- JSON {subject, body}
  short_version          TEXT NOT NULL,
  professional_version   TEXT NOT NULL,
  follow_up_1            TEXT NOT NULL,
  follow_up_2            TEXT NOT NULL,
  objection_responses    TEXT NOT NULL DEFAULT '[]', -- JSON array of {objection,response}
  price_explanation      TEXT NOT NULL,
  call_script            TEXT NOT NULL DEFAULT '[]', -- JSON array
  meeting_agenda         TEXT NOT NULL DEFAULT '[]', -- JSON array
  proposal_outline       TEXT NOT NULL DEFAULT '[]', -- JSON array
  generator              TEXT NOT NULL DEFAULT 'local-rule-engine',
  generated_at           TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at             TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_outreach_prospect ON outreach_messages(prospect_id);

-- Notes -----------------------------------------------------------------------
-- * SQLite resolves circular FKs (experiments.cycle_id <-> agent_cycles) fine
--   at CREATE TABLE time as long as foreign_keys enforcement happens on
--   INSERT, not on table creation — no ALTER TABLE ADD CONSTRAINT needed here,
--   unlike Postgres.
-- * No RLS: the D1 binding is only ever accessible from the Worker, which
--   holds no end-user session — there is a single agent/owner by design.
