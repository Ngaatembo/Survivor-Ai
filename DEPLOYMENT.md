# SURVIVE AI — Deployment guide (Supabase + Cloudflare Workers)

This takes the prototype from *runs in your browser on seeded data* to *runs 24/7
on a cron with live web research*, without rebuilding anything.

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

## 1. Supabase (database)

1. Create a project at https://supabase.com.
2. SQL Editor → paste and run **`supabase/schema.sql`**.
3. Settings → API: copy **Project URL** and two keys:
   - `anon` / `public` key — safe for the browser.
   - `service_role` key — **server secret only** (the Worker uses this).
4. Seed the sample knowledge base (optional but recommended):

   ```bash
   cp .env.example .env
   # edit .env: set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY
   npm install
   npm run seed:supabase
   ```

   The Worker also auto-seeds on its first run if empty (`engine.ensureSeeded()`).

## 2. API keys (live research)

- **Search:** Tavily (https://tavily.com) or Brave Search API (https://brave.com/search/api/). Free tiers cover a discovery pass per cycle.
- **LLM:** Anthropic Claude (https://console.anthropic.com) or OpenAI (https://platform.openai.com). The engine calls cheap models (`claude-haiku` / `gpt-4o-mini`).
- No keys → the engine still runs on the SAMPLE knowledge base and rule engine; connectors read **NOT CONNECTED** honestly.

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
30 minutes: RESEARCH → DISCOVER (live search) → VERIFY → SCORE → RANK →
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

- All money remains **simulated**. The Worker has no payment connector.
- `real_money_enabled` and `daily_spend_limit` on the `agents` table default to
  off / zero. Future real-money actions must pass the (commented)
  `real_money_approvals` table: explicit human approval, limit, and audit log.
- Service-role key and API keys live **only** in Worker secrets / `.env` —
  never in the browser and never committed (`.gitignore` covers `.env` and
  `worker/.dev.vars`).
