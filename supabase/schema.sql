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
create type event_type as enum (
  'SYSTEM', 'CYCLE', 'DISCOVERY', 'RESEARCH', 'VERIFY', 'SCORE',
  'DECISION', 'REJECTION', 'EXPERIMENT', 'WALLET', 'MEMORY', 'WARNING'
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
  daily_spend_limit   numeric(12,2) not null default 0.00
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
  created_at                  timestamptz not null default now()
);
create index idx_opp_agent_stage on opportunities(agent_id, research_stage);
create index idx_opp_score on opportunities(agent_id, score_total desc);

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
