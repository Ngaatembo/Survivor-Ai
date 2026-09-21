# SURVIVE AI — Production deployment guide (D1 + Cloudflare Workers)

This deploys the production path as a 24/7 Cloudflare Worker using D1, live web research, and the shared AgentEngine. SAMPLE records remain development/test fixtures and are never a production fallback.

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

The Worker auto-initializes the production agent row on first cycle when the required tables exist. Starting simulated capital is $50 and `real_money_enabled` remains disabled.

Supabase support is retained only as a legacy repository implementation; it is not the production default.

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
npx wrangler secret put TRIGGER_SECRET        # any long random string
npx wrangler secret put ANTHROPIC_API_KEY     # and/or OPENAI_API_KEY
npx wrangler secret put TAVILY_API_KEY        # and/or BRAVE_API_KEY

# deploy (creates the cron trigger automatically)
npm run worker:deploy
```

Verify:

```bash
curl https://survive-ai.<your-subdomain>.workers.dev/health
# fire a cycle manually (header must match TRIGGER_SECRET):
curl -X POST https://survive-ai.<your-subdomain>.workers.dev/cycles/run \
  -H "x-trigger-secret: YOUR_TRIGGER_SECRET"
# inspect state:
curl https://survive-ai.<your-subdomain>.workers.dev/status
```

The cron (`*/30 * * * *` in `worker/wrangler.toml`) runs one full loop every
30 minutes (Cloudflare Cron schedules are UTC): RESEARCH → DISCOVER (live search) → VERIFY → SCORE → RANK →
SELECT → SIMULATE → MEASURE → LEARN. Finance models stay execution-blocked.

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
  Neither endpoint requires or exposes `TRIGGER_SECRET` — the frontend never
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
