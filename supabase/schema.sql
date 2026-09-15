-- ============================================================================
-- SURVIVE AI — Supabase (PostgreSQL) schema
-- ----------------------------------------------------------------------------
-- Logical database model for the autonomous economic research agent.
-- The v1 prototype persists the same shapes via a localStorage adapter;
-- this DDL is the target backend. All money values are SIMULATED.
-- Run in Supabase SQL editor. Enums + foreign keys + Row Level Security.
-- ============================================================================

-- Enums ----------------------------------------------------------------------

create type agent_status as enum ('ALIVE', 'AT_RISK', 'DEAD', 'RESEARCHING', 'EXECUTING', 'PAUSED');
create type data_source as enum ('SAMPLE', 'LIVE');
create type evidence_tier as enum ('VERIFIED', 'LIKELY', 'UNCERTAIN', 'UNVERIFIED');
create type opportunity_category as enum (
  'Digital Business', 'Content', 'E-Commerce', 'Services', 'Finance', 'Local / Real-World'
);
create type research_stage as enum (
  'UNDISCOVERED', 'DISCOVERED', 'RESEARCHED', 'VERIFIED', 'SCORED', 'RANKED'
);
create type recommendation as enum (
  'HIGH PRIORITY', 'RECOMMENDED', 'WATCHLIST', 'DEPRIORITIZE', 'RESEARCH ONLY'
);
create type experiment_outcome as enum ('SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'INCONCLUSIVE');
create type memory_conclusion as enum ('PROMISING', 'VIABLE', 'MIXED', 'AVOID', 'UNTESTED', 'WATCH');
create type memory_kind as enum ('opportunity', 'category', 'lesson', 'assumption');
create type transaction_type as enum ('DEPOSIT', 'REVENUE', 'EXPENSE', 'REFUND', 'PROFIT', 'LOSS');
create type opportunity_lifecycle_state as enum ('DISCOVERED', 'VALIDATING', 'PROVEN', 'SCALING', 'FAILED', 'ARCHIVED');
create type decision_action as enum ('KILL', 'ITERATE', 'SCALE', 'CONTINUE');
create type event_type as enum (
  'SYSTEM', 'CYCLE', 'DISCOVERY', 'RESEARCH', 'VERIFY', 'SCORE',
  'DECISION', 'REJECTION', 'EXPERIMENT', 'WALLET', 'MEMORY', 'WARNING'
);
create type website_presence as enum ('NONE_FOUND', 'SOCIAL_ONLY', 'WEAK_OR_OUTDATED', 'ADEQUATE', 'UNKNOWN');
create type contact_channel as enum ('PHONE', 'WHATSAPP', 'EMAIL', 'FACEBOOK', 'INSTAGRAM', 'WEBSITE_FORM', 'UNKNOWN');
create type prospect_priority as enum ('HIGH', 'MEDIUM', 'LOW', 'DO_NOT_CONTACT');
create type prospect_status as enum (
  'DISCOVERED', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'INTERESTED',
  'PROPOSAL_SENT', 'NEGOTIATING', 'WON', 'LOST', 'NOT_INTERESTED', 'FOLLOW_UP'
);
create type prospect_interaction_kind as enum (
  'DISCOVERED', 'QUALIFIED', 'OUTREACH_GENERATED', 'STATUS_CHANGE', 'NOTE', 'FOLLOW_UP_SET'
);

-- agents ---------------------------------------------------------------------

create table agents (
  id                  text primary key,
  name                text not null default 'SURVIVE-01',
  status              agent_status not null default 'ALIVE',
  starting_capital    numeric(12,2) not null default 50.00,
  survival_threshold  numeric(12,2) not null default 5.00,
  current_strategy    text,
  current_objective   text,
  cycle_count         int not null default 0,
  total_cycles_run    int not null default 0,
  created_at          timestamptz not null default now(),
  -- hard safety switch: when false, no real-money capability may ever execute
  real_money_enabled  boolean not null default false,
  daily_spend_limit   numeric(12,2) not null default 0.00,
  -- cycle concurrency lock (see migrations/0001_add_cycle_lock.sql for the D1
  -- equivalent): prevents overlapping cron ticks / manual triggers from
  -- racing each other. NULL = not locked.
  cycle_lock_at       timestamptz
);

-- opportunities --------------------------------------------------------------

create table opportunities (
  id                          text primary key,
  agent_id                    text not null references agents(id) on delete cascade,
  name                        text not null,
  category                    opportunity_category not null,
  tags                        text[] not null default '{}',
  data_source                 data_source not null default 'SAMPLE',
  research_stage              research_stage not null default 'UNDISCOVERED',
  description                 text not null,
  how_money_made              text not null,
  capital_required_min        numeric(12,2) not null default 0,
  capital_required_max        numeric(12,2) not null default 0,
  time_to_revenue_days_min    int not null,
  time_to_revenue_days_max    int not null,
  skills                      text[] not null default '{}',
  difficulty                  int not null check (difficulty between 1 and 5),
  competition                 int not null check (competition between 1 and 5),
  scalability                 int not null check (scalability between 1 and 5),
  risk                        int not null check (risk between 1 and 5),
  geographic_relevance        text[] not null default '{}',
  evidence_tier               evidence_tier not null,
  evidence_notes              text,
  success_probability         numeric(4,3) not null check (success_probability between 0 and 1),
  revenue_potential_monthly_min numeric(12,2) not null,
  revenue_potential_monthly_max numeric(12,2) not null,
  upside_note                 text,
  downside_note               text,
  operating_costs_note        text,
  examples                    text[] not null default '{}',
  execution_blocked           boolean not null default false,
  block_reason                text,
  score_total                 int check (score_total between 0 and 100),
  score_recommendation         recommendation,
  score_factors               jsonb not null default '{}',  -- full 9-factor breakdown
  date_researched             timestamptz,
  created_at                  timestamptz not null default now(),
  lifecycle_state             opportunity_lifecycle_state not null default 'DISCOVERED'
);
create index idx_opp_agent_stage on opportunities(agent_id, research_stage);

-- opportunity_models — commercial core (build-spec §3): the concrete,
-- sellable business model behind a promising opportunity. One per
-- opportunity, upserted (onConflict opportunity_id) as evidence improves.
create table opportunity_models (
  id                                text primary key,
  agent_id                          text not null references agents(id) on delete cascade,
  opportunity_id                    text not null unique references opportunities(id) on delete cascade,
  opportunity_name                  text not null default '',
  target_customer                   text not null,
  problem                           text not null,
  offer                             text not null,
  why_they_buy                      text not null,
  suggested_price                   numeric(12,2) not null,
  price_rationale                   text not null,
  delivery_cost_estimate            numeric(12,2) not null,
  expected_gross_margin_pct         numeric(5,2) not null,
  acquisition_channel               text not null,
  sales_message                     text not null,
  follow_up_sequence                jsonb not null default '[]',
  objection_handling                jsonb not null default '[]',
  delivery_workflow                 text not null,
  time_to_first_sale_days_estimate  int not null,
  upsells                           jsonb not null default '[]',
  recurring_revenue_note            text not null default '',
  expected_profit_first_deal        numeric(12,2) not null,
  can_scale                         boolean not null default false,
  scale_note                        text not null default '',
  next_action                       text not null default '',
  confidence                        numeric(4,3) not null default 0,
  generator                         text not null default 'local-rule-engine',
  generated_at                      timestamptz not null default now(),
  updated_at                        timestamptz not null default now()
);
create index idx_models_agent on opportunity_models(agent_id);

-- opportunity_decisions — commercial core (build-spec §5): append-only
-- KILL/ITERATE/SCALE/CONTINUE audit log. Every entry explains why.
create table opportunity_decisions (
  id                text primary key,
  agent_id          text not null references agents(id) on delete cascade,
  opportunity_id    text not null references opportunities(id) on delete cascade,
  opportunity_name  text not null default '',
  action            decision_action not null,
  previous_state    opportunity_lifecycle_state not null,
  new_state         opportunity_lifecycle_state not null,
  reasoning         text not null,
  evidence_summary  text not null,
  metrics           jsonb not null default '{}',
  next_action       text not null default '',
  created_at        timestamptz not null default now()
);
create index idx_decisions_agent_time on opportunity_decisions(agent_id, created_at desc);

-- agent_actions — commercial core (build-spec §16): "what should I do
-- now?" — derived, ranked recommendations, fully replaced every cycle.
create table agent_actions (
  id                text primary key,
  agent_id          text not null references agents(id) on delete cascade,
  kind              text not null,
  opportunity_id    text references opportunities(id),
  opportunity_name  text,
  prospect_id       text,
  prospect_name     text,
  title             text not null,
  description       text not null,
  expected_value    numeric(12,2) not null default 0,
  urgency           int not null default 1,
  effort            int not null default 1,
  rank              int not null default 1,
  created_at        timestamptz not null default now()
);
create index idx_actions_agent_rank on agent_actions(agent_id, rank);
create index idx_opp_score on opportunities(agent_id, score_total desc);

-- prospects — real-world pipeline (build-spec §7/§8). Always traces back to
-- an opportunity; website_presence defaults to UNKNOWN and is only set to a
-- stronger claim when the cited source actually supports it (never fabricated).
create table prospects (
  id                          text primary key,
  agent_id                    text not null references agents(id) on delete cascade,
  opportunity_id              text not null references opportunities(id) on delete cascade,
  opportunity_name            text not null default '',
  business_name               text not null,
  category                    text not null default '',
  location                    text not null default '',
  website_presence            website_presence not null default 'UNKNOWN',
  website_url                 text,
  social_links                text[] not null default '{}',
  contact_channel              contact_channel not null default 'UNKNOWN',
  contact_value                text,
  evidence_notes               text not null default '',
  priority                    prospect_priority not null default 'LOW',
  score                       jsonb not null default '{}', -- LeadScoreBreakdown
  status                      prospect_status not null default 'DISCOVERED',
  data_source                 data_source not null default 'LIVE',
  date_discovered              timestamptz not null default now(),
  last_contact_at              timestamptz,
  next_follow_up_at            timestamptz,
  messages_sent_count          int not null default 0,
  responses_received_count     int not null default 0,
  actual_revenue                numeric(12,2) not null default 0,
  notes                        text[] not null default '{}',
  reason_lost                  text,
  created_at                   timestamptz not null default now(),
  updated_at                   timestamptz not null default now()
);
create index idx_prospects_agent on prospects(agent_id);
create index idx_prospects_opportunity on prospects(opportunity_id);
create index idx_prospects_priority on prospects(agent_id, priority);

create table prospect_sources (
  id            text primary key,
  prospect_id   text not null references prospects(id) on delete cascade,
  title         text not null,
  url           text,
  kind          text not null,
  note          text
);
create index idx_prospect_sources_prospect on prospect_sources(prospect_id);

-- prospect_interactions — append-only observability trail (build-spec §23).
create table prospect_interactions (
  id            text primary key,
  prospect_id   text not null references prospects(id) on delete cascade,
  kind          prospect_interaction_kind not null,
  summary       text not null,
  created_at    timestamptz not null default now()
);
create index idx_prospect_interactions_prospect on prospect_interactions(prospect_id, created_at desc);

-- outreach_messages — AI outreach assistant output (build-spec §9). One row
-- per prospect, upserted (onConflict prospect_id). Prepared for human
-- approval/execution — never sent automatically by this system.
create table outreach_messages (
  id                     text primary key,
  prospect_id            text not null unique references prospects(id) on delete cascade,
  opportunity_id         text not null references opportunities(id) on delete cascade,
  business_model_id      text,
  whatsapp               text not null,
  sms                    text not null,
  email                  jsonb not null default '{}', -- {subject, body}
  short_version          text not null,
  professional_version   text not null,
  follow_up_1            text not null,
  follow_up_2            text not null,
  objection_responses    jsonb not null default '[]',
  price_explanation      text not null,
  call_script            jsonb not null default '[]',
  meeting_agenda         jsonb not null default '[]',
  proposal_outline       jsonb not null default '[]',
  generator              text not null default 'local-rule-engine',
  generated_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_outreach_prospect on outreach_messages(prospect_id);

-- offers, design_briefs, projects — Phase 3 (offer + delivery).
create type offer_status as enum ('DRAFT', 'SENT', 'ACCEPTED', 'DECLINED');
create type design_asset_status as enum ('NOT_CONFIGURED', 'GENERATING', 'READY');
create type project_status as enum ('ACTIVE', 'DELIVERED', 'CANCELLED');

create table offers (
  id                     text primary key,
  prospect_id            text not null unique references prospects(id) on delete cascade,
  prospect_name          text not null default '',
  opportunity_id         text not null references opportunities(id) on delete cascade,
  business_model_id      text,
  price                  numeric(12,2) not null default 0,
  timeline_days_min      int not null default 0,
  timeline_days_max      int not null default 0,
  deliverables           jsonb not null default '[]',
  gap_analysis           text,
  website_brief          jsonb not null default '{}',
  status                 offer_status not null default 'DRAFT',
  generator              text not null default 'local-rule-engine',
  generated_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_offers_prospect on offers(prospect_id);
create index idx_offers_opportunity on offers(opportunity_id);

create table design_briefs (
  id                     text primary key,
  offer_id               text not null unique references offers(id) on delete cascade,
  prospect_id            text not null references prospects(id) on delete cascade,
  homepage_concept       text not null default '',
  hero_section           text not null default '',
  logo_direction         text not null default '',
  social_graphics        jsonb not null default '[]',
  color_direction_note   text not null default '',
  asset_status           design_asset_status not null default 'NOT_CONFIGURED',
  generated_at           timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create index idx_design_briefs_prospect on design_briefs(prospect_id);

create table projects (
  id                          text primary key,
  prospect_id                 text not null unique references prospects(id) on delete cascade,
  prospect_name               text not null default '',
  offer_id                    text not null references offers(id) on delete cascade,
  opportunity_id              text not null references opportunities(id) on delete cascade,
  agreed_price                numeric(12,2) not null default 0,
  agreed_timeline_days_max    int not null default 0,
  milestones                  jsonb not null default '[]',
  status                      project_status not null default 'ACTIVE',
  started_at                  timestamptz not null default now(),
  delivered_at                timestamptz,
  updated_at                  timestamptz not null default now(),
  -- Real-world outcome tracking (Phase 4, §15) — nullable, filled in by a
  -- human once known.
  satisfaction                int,
  repeat_purchase             boolean,
  referral                    boolean
);
create index idx_projects_prospect on projects(prospect_id);
create index idx_projects_opportunity on projects(opportunity_id);

-- real_revenue, learning_events — Phase 4 (real revenue). Both append-only:
-- rows are inserted, never updated or deleted, so this stays an honest
-- audit trail of actual money and the data points that came from it.
create type payment_method as enum ('CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD', 'OTHER');
create type learning_event_kind as enum ('REAL_REVENUE_RECORDED', 'PREDICTION_VS_ACTUAL');

create table real_revenue (
  id                                 text primary key,
  date                               timestamptz not null default now(),
  opportunity_id                     text not null references opportunities(id) on delete cascade,
  opportunity_name                   text not null default '',
  prospect_id                        text not null references prospects(id) on delete cascade,
  prospect_name                      text not null default '',
  project_id                         text not null references projects(id) on delete cascade,
  product_service                    text not null default '',
  quoted_price                       numeric(12,2) not null default 0,
  amount_received                    numeric(12,2) not null default 0,
  costs                              numeric(12,2) not null default 0,
  profit                             numeric(12,2) not null default 0,
  currency                           text not null default 'USD',
  payment_method                     payment_method not null default 'OTHER',
  acquisition_channel                text not null default '',
  days_from_discovery_to_payment     int not null default 0,
  notes                              text,
  created_at                         timestamptz not null default now()
);
create index idx_real_revenue_opportunity on real_revenue(opportunity_id);
create index idx_real_revenue_project on real_revenue(project_id);

create table learning_events (
  id                 text primary key,
  kind               learning_event_kind not null,
  opportunity_id     text not null references opportunities(id) on delete cascade,
  category           text not null,
  ref_id             text not null,
  summary            text not null,
  predicted_value    numeric(12,2),
  actual_value       numeric(12,2),
  delta_pct          numeric(6,2),
  created_at         timestamptz not null default now()
);
create index idx_learning_events_opportunity on learning_events(opportunity_id);
create index idx_learning_events_category on learning_events(category);

-- prospect_intelligence — Phase 6 (deep, business-specific research). One
-- report per prospect, regenerated (upserted) as new research runs.
create type intelligence_confidence as enum ('HIGH', 'MEDIUM', 'LOW');
create type intelligence_generator as enum ('llm', 'snippet-digest');

create table prospect_intelligence (
  id                            text primary key,
  prospect_id                   text not null unique references prospects(id) on delete cascade,
  business_overview             text not null default '',
  apparent_services             jsonb not null default '[]',
  social_presence_summary       text not null default '',
  competitive_note              text not null default '',
  specific_problem_evidence     text not null default '',
  recommended_angle             text not null default '',
  confidence                    intelligence_confidence not null default 'LOW',
  generator                     intelligence_generator not null default 'snippet-digest',
  sources                       jsonb not null default '[]',
  generated_at                  timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);
create index idx_prospect_intelligence_prospect on prospect_intelligence(prospect_id);

-- prospect_demos — Phase 3 (deepened): a real, working single-page demo
-- website built for one specific prospect. One per offer.
create type demo_generator as enum ('llm', 'template');

create table prospect_demos (
  id                    text primary key,
  prospect_id           text not null unique references prospects(id) on delete cascade,
  offer_id              text not null references offers(id) on delete cascade,
  business_name         text not null default '',
  html                  text not null default '',
  hero_headline         text not null default '',
  sections_included     jsonb not null default '[]',
  generator             demo_generator not null default 'template',
  generated_at          timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index idx_prospect_demos_prospect on prospect_demos(prospect_id);
create index idx_prospect_demos_offer on prospect_demos(offer_id);

-- research_sources -----------------------------------------------------------

create table research_sources (
  id                text primary key,
  opportunity_id    text not null references opportunities(id) on delete cascade,
  title             text not null,
  url               text,
  kind              text not null, -- platform | report | community | academic | sample-note | web
  note              text,
  verified          boolean not null default false,
  retrieved_at      timestamptz
);

-- research_reports -----------------------------------------------------------

create table research_reports (
  id                    text primary key,
  agent_id              text not null references agents(id) on delete cascade,
  opportunity_id        text not null references opportunities(id) on delete cascade,
  opportunity_name      text not null default '',
  generator             text not null default 'local-rule-engine', -- 'local-rule-engine' | 'llm:claude' | ...
  executive_summary     text not null,
  market_opportunity    text,
  how_it_works          text,
  capital_requirements  text,
  competition           text,
  risks                 text[] not null default '{}',
  evidence              text,
  potential_revenue     text,
  recommended_experiment text,
  confidence            numeric(4,3) not null,
  final_score           int not null,
  data_source           data_source not null default 'SAMPLE',
  created_at            timestamptz not null default now()
);

-- experiments + results ------------------------------------------------------

create table experiments (
  id                  text primary key,
  agent_id            text not null references agents(id) on delete cascade,
  cycle_id            text, -- fk added after agent_cycles
  opportunity_id      text not null references opportunities(id),
  -- denormalized for ledger/display without a join
  opportunity_name    text not null default '',
  category            opportunity_category not null default 'Services',
  objective           text not null,
  starting_budget     numeric(12,2) not null,
  planned_action      text not null,
  expected_outcome    text,
  simulated           boolean not null default true,
  status              text not null default 'PLANNED', -- PLANNED | RUNNING | COMPLETE
  created_at          timestamptz not null default now()
);

create table experiment_results (
  id                  text primary key,
  experiment_id       text not null unique references experiments(id) on delete cascade,
  outcome             experiment_outcome not null,
  actual_cost         numeric(12,2) not null,
  actual_revenue      numeric(12,2) not null,
  profit_loss         numeric(12,2) not null,
  roi_pct             numeric(10,2) not null,
  duration_days       int,
  lessons_learned     text[] not null default '{}',
  evidence_note       text,
  raw_simulation      jsonb,  -- probability, roll, parameters
  created_at          timestamptz not null default now()
);

-- agent_memory ---------------------------------------------------------------

create table agent_memory (
  id            text primary key,
  agent_id      text not null references agents(id) on delete cascade,
  kind          memory_kind not null,
  ref_type      text,          -- 'opportunity' | 'category'
  ref_id        text,          -- opportunity uuid or category name
  title         text not null,
  tests         int not null default 0,
  spent         numeric(12,2) not null default 0,
  revenue       numeric(12,2) not null default 0,
  conclusion    memory_conclusion not null default 'UNTESTED',
  notes         text[] not null default '{}',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_memory_agent on agent_memory(agent_id, kind);

-- transactions (append-only ledger) -----------------------------------------

create table transactions (
  id                    text primary key,
  agent_id              text not null references agents(id) on delete cascade,
  type                  transaction_type not null,
  amount                numeric(12,2) not null,   -- signed: + in, - out
  description           text not null,
  related_experiment_id text references experiments(id),
  balance_after         numeric(12,2) not null,   -- denormalized checkpoint
  created_at            timestamptz not null default now()
);
-- Balance is always derived: SUM(amount). The ledger is append-only.
create index idx_tx_agent_time on transactions(agent_id, created_at);

-- agent_events ---------------------------------------------------------------

create table agent_events (
  id          text primary key,
  agent_id    text not null references agents(id) on delete cascade,
  type        event_type not null,
  message     text not null,
  data        jsonb,
  created_at  timestamptz not null default now()
);
create index idx_events_agent_time on agent_events(agent_id, created_at desc);

-- strategies -----------------------------------------------------------------

create table strategies (
  id          text primary key,
  agent_id    text not null references agents(id) on delete cascade,
  name        text not null,
  rationale   text,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

-- agent_cycles ---------------------------------------------------------------

create table agent_cycles (
  id                  text primary key,
  agent_id            text not null references agents(id) on delete cascade,
  cycle_index         int not null,
  steps               jsonb not null default '[]',  -- per-step status/timestamps
  discovered_ids      text[] not null default '{}',
  selected_opportunity_id text references opportunities(id),
  experiment_id       text references experiments(id),
  summary             text,
  started_at          timestamptz not null default now(),
  completed_at        timestamptz
);

alter table experiments
  add constraint fk_experiments_cycle foreign key (cycle_id) references agent_cycles(id);

-- ---------------------------------------------------------------------------
-- Row Level Security: single-owner agents. All tables restricted to the
-- authenticated user; the agent service role writes with service key.
-- Real-money actions (future) require an additional approval table:
-- ---------------------------------------------------------------------------
-- create table real_money_approvals (
--   id text primary key,
--   agent_id text not null references agents(id),
--   action text not null,
--   amount numeric(12,2) not null,
--   approved_by text references auth.users(id),
--   approved_at timestamptz,
--   expires_at timestamptz,
--   status text not null default 'PENDING'  -- PENDING | APPROVED | DENIED | EXECUTED
-- );

alter table agents enable row level security;
alter table opportunities enable row level security;
alter table research_sources enable row level security;
alter table research_reports enable row level security;
alter table experiments enable row level security;
alter table experiment_results enable row level security;
alter table agent_memory enable row level security;
alter table transactions enable row level security;
alter table agent_events enable row level security;
alter table strategies enable row level security;
alter table agent_cycles enable row level security;

-- Example policy (repeat per table); swap auth.uid() scoping as needed:
-- create policy "owner access" on agents
--   for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
