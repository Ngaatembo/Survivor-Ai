# SURVIVE AI — Production deployment guide (D1 + Cloudflare Workers)

This deploys the production path as a 24/7 Cloudflare Worker using D1, live web research, treasury controls, revenue verification, and the shared AgentEngine. SAMPLE records remain development/test fixtures and are never a production fallback.

Architecture after deployment:

```
        Cloudflare Worker (cron every 30m)
   ┌───────────────┬───────────────┐        ┌─────────────────┐
   │  AgentEngine  │ providers:    │        │  Supabase       │
   │  (shared code)│ search + LLM  │──────▶│  Postgres (11   │
   └───────────────┴───────┬───────┘        │  normalized     │
                           │                │  tables)        │
   Tavily/Brave search ────┤                └─────────────────┘
   Anthropic/OpenAI LLM ───┘
                           ▲
   React dashboard ────────┘ (optional: point it at Supabase too)
```

---

## 1. Cloudflare D1 (production database)

The production Worker is configured with the D1 database `survivor-ai` in `worker/wrangler.toml`.

Apply schema/migrations deliberately with Wrangler against the **remote** D1 database. Do not assume a GitHub push applies migrations automatically.

The Worker auto-initializes the production agent row on first cycle when the required tables exist. The production treasury separates owner capital, operating costs, verified revenue and legacy simulated history. Real-money execution remains disabled.

Supabase support is retained only as a legacy repository implementation; it is not the production default. It has no truthful ledger, so a Worker on the Supabase backend refuses to run cycles.

### Paid-call containment (migration 0023, incident 5 Oct 2026)

Every paid AI/search call now needs an authorization row in `spend_authorizations`, created by one atomic statement that checks the kill switch, the run, per-call / per-cycle / per-request / daily caps and the runway reserve **before** the request is sent. Defaults and meaning: `src/economy/spendLimits.ts`.

- `AUTONOMOUS_PAID_CALLS` — unset by default: Survivor's own cycles make **no** paid calls. Set to `enabled` only deliberately.
- `TAVILY_USD_PER_CREDIT` / `BRAVE_USD_PER_QUERY` — your plan's real price. **No default**: an unpriced provider is never called. Tavily bills basic search as 1 credit and advanced as 2.
- The dashboard never calls paid providers; `VITE_*` provider keys are ignored.

```bash
npx wrangler d1 execute survivor-ai --remote --file=./migrations/0023_spend_authorizations.sql
```

Apply 0021, 0022 and 0023 (in that order) before deploying this code.

### Truthful ledger rollout (migrations 0021 + 0022, Oct 2026)

Apply **before** deploying the code that reads them (the new code queries `survivor_runs` and the new `transactions` columns; `/health` reports `ready: false` until they exist). Each must run exactly once:

```bash
npx wrangler d1 execute survivor-ai --remote --file=./migrations/0021_prospect_problem_persistence.sql
npx wrangler d1 execute survivor-ai --remote --file=./migrations/0022_truthful_ledger.sql
```

What 0022 does to existing production data:

- the existing REAL `$50` opening deposit becomes run `run_agent-survive-01_001` (PRODUCTION, ALIVE, death threshold `$0`, depleted threshold `$5`);
- old SIMULATED ledger rows are labelled `LEGACY_SIMULATION` and stay outside every run;
- every existing `agent_memory` row is marked `SIMULATED_LEGACY` and stops influencing decisions;
- triggers make ledger rows immutable and DEAD/ENDED runs final.

Money rules after 0022:

- Capital enters **only** as a new run's starting capital: `POST /runs` (admin). `POST /treasury/record-capital` returns 410.
- Revenue is credited only from a provider-verified payment (`POST /real-revenue/verify-finivex`), once per provider transaction id.
- Every paid AI call and search is its own ledger entry, posted when the provider answers, linked to its authorization. There are no default search prices (see containment above).
- When the run's balance reaches its death threshold the run is DEAD: no cycles, no spending, no revival.

Start a new experiment (admin):

```bash
curl -X POST https://<worker>/runs -H "x-admin-secret: $ADMIN_SECRET" -H 'content-type: application/json' \
  -d '{"environment":"PRODUCTION","startingCapital":50,"label":"second $50 run","endOpenRunReason":"only if a run is still open"}'
```

Emergency stop (any operator) and release (admin only):

```bash
curl -X POST https://<worker>/control/kill-switch/engage  -H "authorization: Bearer $OPERATOR_TOKEN" -d '{"reason":"..."}'
curl -X POST https://<worker>/control/kill-switch/release -H "x-admin-secret: $ADMIN_SECRET" -d '{"reason":"..."}'
```

Seed the development/sample knowledge base (optional; never required for production):

   ```bash
   cp .env.example .env
   # edit .env: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
   npm install
   npm run seed:supabase
   ```

   The Worker auto-initializes production agent state on its first run if empty (`engine.ensureSeeded()`); it does not populate the legacy SAMPLE opportunity set.

## 2. API keys (live research)

- **Search:** Tavily (https://tavily.com) or Brave Search API (https://brave.com/search/api/). Free tiers cover a discovery pass per cycle.
- **LLM:** Anthropic Claude (https://console.anthropic.com) or OpenAI (https://platform.openai.com). The engine calls cheap models (`claude-haiku` / `gpt-4o-mini`).
- No search/LLM keys → live discovery yields no new LIVE opportunities. The production Worker does **not** silently substitute SAMPLE records.

## 3. Cloudflare Worker (24/7 scheduler)

```bash
# one-time: log in
npx wrangler login

# set the project URL in worker/wrangler.toml (SUPABASE_URL)
# then set secrets:
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
npx wrangler secret put TRIGGER_SECRET        # operator password for POST /auth/login
npx wrangler secret put ADMIN_SECRET          # separate admin credential (x-admin-secret); falls back to TRIGGER_SECRET if unset
npx wrangler secret put ANTHROPIC_API_KEY     # and/or OPENAI_API_KEY
npx wrangler secret put TAVILY_API_KEY        # and/or BRAVE_API_KEY

# deploy (creates the cron trigger automatically)
npm run worker:deploy
```

Verify:

```bash
curl https://survive-ai.<your-subdomain>.workers.dev/health
# fire a cycle manually (admin credential):
curl -X POST https://survive-ai.<your-subdomain>.workers.dev/cycles/run \
  -H "x-admin-secret: YOUR_ADMIN_SECRET"
# inspect state (operator session from POST /auth/login):
curl https://survive-ai.<your-subdomain>.workers.dev/status -H "authorization: Bearer YOUR_SESSION_TOKEN"
```

The cron (`*/30 * * * *` in `worker/wrangler.toml`) runs one full loop every
30 minutes (Cloudflare Cron schedules are UTC): RESEARCH → DISCOVER (live search) → VERIFY → SCORE → RANK →
SELECT → (SIMULATE is disabled in production) → MEASURE → LEARN. Finance models stay execution-blocked.
A cycle is refused while the kill switch is engaged or when there is no ALIVE/DEPLETED run.

### Local worker development

```bash
cp worker/.dev.vars.example worker/.dev.vars   # fill in keys
npm run worker:dev
```

## 4. Pointing the dashboard at the live backend

The browser app defaults to a fully standalone DEMO mode (localStorage +
local rule engine, clearly labeled in the sidebar) so it still works with
zero configuration. To make the dashboard a read-only mirror of the
deployed Worker/D1 instead — the real fix for the frontend/backend
disconnect — set one build-time variable:

```bash
# .env (frontend build)
VITE_API_BASE_URL=https://survivor-ai-backend.<your-subdomain>.workers.dev
```

When this is set:

- On load, and every 15s after, the dashboard calls the Worker's `GET
  /state` (full agent/opportunities/experiments/wallet/memory/activity/
  cycles/reports snapshot) and `GET /health`, and renders exactly that data.
  `/state` requires the operator session (the dashboard asks for the
  operator secret once and keeps an 8-hour session token); `/health` is
  public and carries no balances or business data. The frontend never
  triggers cycles; the Worker's cron is the only thing that runs them.
- The local autonomous-loop controls (START RESEARCH / RUN NEXT CYCLE /
  manual experiments / RESET) are disabled — the topbar shows a live status
  pill (`● LIVE — cron-driven`) instead, so there is only ever one place a
  cycle can be started, and only one wallet/opportunity/experiment dataset
  the dashboard will ever show.
- If the backend is unreachable, the UI shows an explicit "Backend
  unreachable" banner with the real error — it never falls back to inventing
  local data to fill the gap.
- Nothing about business state is written to localStorage in this mode
  (only UI preferences would be, if any are ever added) — D1 via the Worker
  is the single source of truth end-to-end.

`src/engine/supabaseRepository.ts` remains available for the (legacy,
non-default) `DB_BACKEND=supabase` path if you ever run the Worker against
Supabase instead of D1, but the browser talks to it only indirectly, through
the Worker's HTTP API above — the browser is never given a Supabase key.

## 5. Push to GitHub

See the chat where this was set up — the repo is git-initialized and committed.
Push commands:

```bash
git remote add origin https://github.com/<you>/survive-ai.git
git branch -M main
git push -u origin main
```

(Authenticate with a GitHub Personal Access Token as the password, or install
`gh` and run `gh auth login`.)

---

## Safety reminders

- Economic experiments remain simulated. EcoCash sandbox confirmations are test events only and are never counted as real revenue; real-world revenue is recorded separately by a human after an actual payment.
- `real_money_enabled` and `daily_spend_limit` on the `agents` table remain off / zero. Treasury v1 is an authorization/accounting layer only; it does not send money.
- Service-role key and API keys live **only** in Worker secrets / `.env` —
  never in the browser and never committed (`.gitignore` covers `.env` and
  `worker/.dev.vars`).
