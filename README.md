# SURVIVE AI — Autonomous Economic Research & Revenue Engine

Survivor is an autonomous economic research and revenue-operations system. It discovers and verifies opportunities, researches prospects, generates offers/demos, tracks outreach and verified revenue, learns from outcomes, controls search/LLM costs, and maintains an explicit survival/treasury state.

## Current production boundary

The production Worker runs against Cloudflare D1 and executes a research cycle on a 30-minute cron.

**Real-money execution is disabled.** The treasury is an accounting/authorization layer, and human approval remains required for real-world revenue actions. Payment integrations are sandbox/test constrained where applicable.

The production treasury now distinguishes simulated history from real ledger entries. The current production model seeds owner capital separately from old simulated experiments so simulated balances cannot silently become real money.

## Autonomous production loop

```
SEARCH ECONOMY GATE
        ↓
DISCOVER → VERIFY → RESOLVE
        ↓
DEEP RESEARCH / MARKET PRICING
        ↓
SCORE / RANK
        ↓
OFFER + DEMO
        ↓
HUMAN ACTION / APPROVAL QUEUE
        ↓
OUTREACH / FOLLOW-UP
        ↓
INDEPENDENT REVENUE VERIFICATION
        ↓
REAL TREASURY + LEARNING
        ↺
```

The Worker is the production execution boundary. The browser dashboard is a view/control surface and must not become a second autonomous production loop.

## Production architecture

- **Cloudflare Worker:** scheduled backend and authenticated operator endpoints.
- **Cloudflare D1:** production persistence.
- **Supabase repository:** retained as a legacy/alternate repository implementation, not the production default.
- **Search:** Tavily and/or Brave, subject to the search-economy controls.
- **LLM:** Anthropic, OpenAI and Gemini providers, subject to the cost meter.
- **Payments:** sandbox/test integrations plus human-controlled revenue recording and verification.
- **Dashboard:** React/Vite frontend consuming the Worker in live mode.

## Economic controls

The production system includes:

- real treasury ledger
- automatic daily AI/search spend cap
- dormant-floor protection
- survival states
- search-result caching and budget controls
- survival-aware action ranking
- market-price research
- prospect verification
- deep prospect intelligence
- revenue funnel analytics
- independent revenue verification
- human approval queue
- production guard
- production runtime smoke test

Simulated experiments remain explicitly separated from the real-revenue ledger.

## Database and migrations

D1 migrations are deliberately applied separately from application deployment. The deploy workflow does **not** silently execute production SQL.

The current migration chain is maintained under `migrations/`. Before production operation, the Worker health endpoint must report the required schema as ready. If schema readiness fails, the production path must be treated as unhealthy rather than allowing the dashboard to invent or substitute state.

## Verification

Before merging/deploying, the repository should pass:

```bash
npm ci
npm run production:guard
npm run typecheck
npm run build
```

The production deployment workflow also performs a Worker dry-run and a post-deploy runtime smoke test.

## Important engineering rule

A feature is not considered complete merely because the UI exists or the deployment is green.

For Survivor, completion means:

**implemented → integrated → failure path tested → production boundary checked → documented.**

