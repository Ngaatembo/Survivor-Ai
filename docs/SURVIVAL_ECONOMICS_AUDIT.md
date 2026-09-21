# SURVIVE AI — Search Economics Audit

**Date:** 2026-09-21
**Scope:** Full repository audit of every place a search or LLM call happens, before any code changes described in the rest of this document were made. Numbers below are computed from the code as it existed at commit time on the `main` branch (pre-overhaul), not from live telemetry — this project has no analytics pipeline recording historical search volume, so every "before" number here is a **derived estimate from reading the code**, labeled as such, with the exact assumptions stated.

---

## 1. System map

| Layer | File(s) | Role |
|---|---|---|
| Frontend | `src/App.tsx`, `src/components/*` | React/Vite dashboard. Reads state either from a local browser demo (Zustand + localStorage) or, when `VITE_API_BASE_URL` is set, read-only from the deployed Worker (`GET /state`). Never holds service-role secrets; `VITE_TAVILY_API_KEY`/`VITE_BRAVE_API_KEY` are **only** used by the local standalone demo mode, which is fully disabled the moment a backend URL is configured (`guardLocalMutation` in `src/store.ts`). |
| AgentEngine / cycle | `src/engine/agentEngine.ts` | The transport-independent autonomous loop: RESEARCH → DISCOVER → VERIFY → SCORE → RANK → SELECT → SIMULATE → MEASURE → LEARN. Same class drives both the browser demo and the Worker. |
| Opportunity discovery | `src/services/liveResearch.ts` | 6 fixed category queries against a `SearchProvider`, optionally analyzed by an LLM. |
| Prospect discovery | `src/services/prospectDiscovery.ts` | Local-business discovery for `Local / Real-World` opportunities; rotates 5 seed categories, 3/day by design already. |
| Prospect intelligence | `src/services/prospectIntelligence.ts` | Deep, business-specific research (3 queries) for one prospect. |
| Market pricing | `src/services/marketPricing.ts` | Real going-rate research (3 queries) for one opportunity, replacing a pure-formula guess. |
| Search providers | `src/services/providers/search.ts` | Tavily + Brave HTTP clients. **Pre-overhaul: `createSearchProvider()` always returned Tavily if a Tavily key existed, Brave only as a fallback — no cost, purpose, or budget awareness at all.** |
| LLM | `src/services/providers/llm.ts`, `src/services/ai.ts` | Anthropic/OpenAI clients + the (non-LLM) rule-based decision/report engine used regardless of LLM connectivity. |
| Offer/demo/outreach | `src/lib/offerGenerator.ts`, `demoGenerator.ts`, `outreachGenerator.ts`, `designBriefGenerator.ts` | Pure functions, no search/LLM calls of their own (they consume prospect intelligence + market pricing already gathered). |
| Real-revenue ledger | `src/lib/realRevenue.ts`, worker `POST /real-revenue` | Human-entered actual payments; already feeds a category-level close-rate/profit blend into scoring (`computeCategoryRealWorldStats`, `blendWithReal`) — this was already well-built pre-overhaul (see §5 note). |
| Missions | `src/lib/missions.ts` | Survival milestone ladder against the simulated wallet balance. Unrelated to search cost. |
| Analytics | `src/components/Analytics.tsx`, `src/lib/realRevenue.ts` | Simulation-vs-reality comparison. No search-cost analytics existed pre-overhaul — this gap is exactly Phases 6/14/15. |
| D1 / Supabase | `src/engine/d1Repository.ts`, `supabaseRepository.ts`, `migrations/*.sql`, `supabase/schema.sql`, `schema.d1.sql` | D1 is the default (`DB_BACKEND=d1`); Supabase is kept as an explicit legacy fallback path, same interface (`EngineRepository`). |
| Cloudflare Worker | `worker/src/index.ts`, `worker/wrangler.toml` | HTTP API + `scheduled()` cron handler, `*/30 * * * *`. Holds all secrets; frontend never receives them. |
| GitHub Actions | `.github/workflows/deploy.yml` | `npm install && npm run worker:deploy` on push to `main`. **No migration-apply step exists in this workflow at all** — see §6. |
| Migrations | `migrations/0001`–`0010` | Additive-only SQL, applied manually via `wrangler d1 execute`. `schema.d1.sql`/`supabase/schema.sql` are the "apply once on a fresh DB" baselines, kept in sync per-migration for Supabase but **not** for D1 past migration ~0003 (D1's source of truth is the migration files themselves, per the header comment in `worker/wrangler.toml`). |
| Env vars / secrets | `.env.example`, `worker/.dev.vars.example`, `worker/wrangler.toml` | `TAVILY_API_KEY`, `BRAVE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TRIGGER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` are Worker secrets (`wrangler secret put`), never in `[vars]`, never shipped to the browser in backend mode. |

---

## 2. Search-cost map (pre-overhaul)

For every search operation, before any change in this overhaul:

| # | File / function | Trigger | Searches / invocation | Max searches / cycle | Frequency | Est. searches/day | Est. searches/month | Business purpose | Essential? | Cacheable? | Skippable? | Could reuse stored data? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `liveResearch.discoverLive()` | **Unconditional** every cycle whenever a search provider is connected | 6 (one per fixed category) | 6 | Every 30 min (cron) | **288** | **8,640** | Find new business-model opportunities | Partially — new opportunities matter, but not every 30 min | Yes (results for "AI websites Zimbabwe 2025" barely change in 30 min) | Yes | Yes — 6 fixed categories rarely change; results are stable for days |
| 2 | `prospectDiscovery.discoverProspects()` | **Unconditional** every cycle, for up to 2 "pursuable" Local/Real-World opportunities | 3 queries × up to 2 opportunities = up to 6 | 6 | Every 30 min, once ≥1 opportunity reaches `VALIDATING`+ | Up to **288** | Up to **8,640** | Find local businesses that might need a website | Yes, but not at this frequency | Yes | Yes | Yes — the same 5 seed categories rotate daily already (`rotatedSeeds`), so most of this was already redundant with the previous cycle 30 minutes earlier |
| 3 | `prospectIntelligence.researchProspect()` | Once per prospect, first time it lacks an intelligence report (already gated by `!existingIntelligence.some(...)`) | 3 | 9 (3 prospects × 3 queries, capped `slice(0,3)`) | Every 30 min, only while prospects lack a report | Bursty, ≤9 during pipeline growth, →0 at steady state | Bursty | Get business-specific facts to inform outreach | Yes | Yes (but wasn't cached — see note) | N/A once already run once | Already effectively "run once" by the `!existingIntelligence.some()` filter — the real gap here was no TTL-based refresh path for a prospect whose status later changes (e.g. goes INTERESTED), not runaway repetition |
| 4 | `marketPricing.researchMarketPrice()` | Once per opportunity, first time it lacks pricing (`!existingPricing.some(...)`) | 3 | 3–6 (bounded by `needsOffer.slice(0,5)` opportunities sharing pricing) | Every 30 min, only while an opportunity about to get an offer lacks pricing | Bursty, low | Bursty, low | Quote a real price instead of a formula guess | Yes | Yes (wasn't cached) | N/A once already run once | Same as #3 — already roughly once-per-opportunity by construction |
| 5 | LLM calls (`analyzeOpportunity`, `analyzeProspect`, `analyzeMarketPrice`) | Alongside #1–4 whenever an LLM is connected | 1 per search-bearing call above | Same order as #1–4 | Same as #1–4 | Same order as #1–4 | Same order as #1–4 | Turn snippets into structured, evidence-tagged fields | Yes | N/A (LLM output isn't independently cached — it rides along with #1–4's cache) | Tied to #1–4 | Now inherits #1–4's caching once wired through `searchEconomy.ts` |

### Maximum theoretical usage (pre-overhaul)

- Per cycle: 6 (opportunity discovery) + 6 (prospect discovery) + 9 (prospect intelligence, only while backlog exists) + 6 (pricing, only while backlog exists) = **up to 27 searches in a single cycle** during a pipeline's early growth phase.
- Steady state (no new prospects/opportunities needing first-time intelligence or pricing): **12 searches every 30 minutes, forever** (items #1 and #2 never stop, since neither had any recency check) = **576/day = ~17,280/month**.
- This is the actual defect the spec calls "the same business is researched repeatedly" / "the same opportunity is researched repeatedly": items #1 and #2 had **zero information-value gate** — they ran the full query set every single cron tick regardless of whether the previous run 30 minutes earlier had already covered that exact category/seed. Items #3 and #4 were **already reasonably bounded** by their own once-per-entity filters — the audit did not find runaway repetition there, only a missing refresh path for later status changes (fixed in Phase 4's `shouldSearch()`).

### Realistic usage scenario (pre-overhaul)

With one Tavily or Brave key connected and at least one `Local / Real-World` opportunity validated: **~576 searches/day** at steady state (items #1+#2 alone), rising briefly to ~600–700/day while new prospects/opportunities are still getting their first intelligence/pricing pass. **Brave's free tier is 2,000 queries/month** — this pre-overhaul steady-state rate (~17,000/month) would exhaust a free Brave tier in under 4 days and would run up meaningful cost on Tavily's paid tiers within the first week of continuous operation, for two search operations (#1, #2) whose actual information content barely changes cycle to cycle.

---

## 3. Provider selection (pre-overhaul)

`src/services/providers/search.ts`, pre-overhaul:

```ts
export function createSearchProvider(keys) {
  if (keys.tavily) return new TavilyProvider(keys.tavily);
  if (keys.brave) return new BraveProvider(keys.brave);
  return null;
}
```

This is exactly the anti-pattern the spec calls out: **Tavily wins unconditionally whenever its key exists**, with no regard for purpose, cost, or remaining budget — even for a purpose (e.g. plain category discovery) where Brave's cheaper free tier would do just as well. There was also no per-purpose, per-day, or per-month budget of any kind — only ad-hoc per-cycle caps scattered across `liveResearch.ts` (`DISCOVERY_QUERIES.length`), `prospectDiscovery.ts` (`MAX_QUERIES_PER_CYCLE`), `prospectIntelligence.ts`/`marketPricing.ts` (`MAX_SNIPPETS`, 3 fixed queries) — four different files, four different ad-hoc numbers, no shared policy, no daily/monthly ceiling, no cache.

---

## 4. What was already good (do not rebuild)

Per the spec's own "MOST IMPORTANT RULE" and "before implementing large architectural changes, inspect what already exists and reuse it," this audit specifically flags what **not** to rebuild, because it already does the job the spec asks for:

- **Fabrication safety (Phase 16).** `prospectDiscovery.ts` already excludes Facebook groups, requires either a commercial-signal snippet or an own-domain result before creating a prospect, validates phone-number digit counts, and defaults website presence to `UNKNOWN` rather than guessing. `prospectIntelligence.ts`/`marketPricing.ts` already fall back to an honest "no evidence" digest (a `$0` price range, an empty overview) rather than ever fabricating a number when no LLM is connected or the LLM's output is unusable. **No changes were made to this logic** — it was already correct and is exercised by `scripts/prospectPipeline.smoke.ts` and `scripts/dataQuality.smoke.ts`, both of which still pass unmodified.
- **Real-revenue feedback loop (Phase 13).** `src/lib/realRevenue.ts` already updates category performance, close rate, average deal value, and a bounded, explainable scoring blend (`blendWithReal`, `MIN_SAMPLE_FOR_BLEND`, `MAX_REAL_WEIGHT`) the moment a real payment is recorded (`worker/src/index.ts`'s `POST /real-revenue` handler calls `foldRealRevenueIntoMemory` and `generateLearningEvent` synchronously, not on the next cron tick). This already lets a category that repeatedly converts receive more weight, and one that doesn't get deprioritized, with **no hard-coded winner** — exactly what Phase 13 asks for. This overhaul does not touch that logic; it only adds a `conversionByAcquisitionChannel` breakdown (`src/lib/revenueFunnel.ts`) that was genuinely missing.
- **Revenue-oriented recommendation engine (Phase 7).** `src/lib/recommendedActions.ts` already ranks `CONTACT_PROSPECT` / `FOLLOW_UP_PROSPECT` / `SEND_OFFER` / `ADVANCE_PROJECT` above generic research actions by expected value, already down-weights high-effort actions harder as survival status worsens (`survivalWeight()`), and already never recommends "research more" over an available sales action, because sales actions are already scored with the prospect's real `expectedValue`, which is typically far higher than a bare `WAIT_FOR_EVIDENCE` action's discounted score. **"NEXT MONEY ACTION" (Phase 7) is simply `actions[0]` from this existing, already-correct engine** — this overhaul surfaces it in a dedicated dashboard panel rather than re-deriving it.
- **The funnel's stage data already exists.** `Prospect.status` (`src/types.ts`) already is `DISCOVERED → QUALIFIED → CONTACTED → REPLIED → INTERESTED → PROPOSAL_SENT → NEGOTIATING → WON | LOST | NOT_INTERESTED | FOLLOW_UP`, exactly the funnel the spec asks for. What was missing was the **analytics layer on top** (cumulative stage counts, conversion rates, category/channel breakdowns) — that gap is `src/lib/revenueFunnel.ts`, new in this overhaul.

## 5. What was genuinely missing (the real gap this overhaul fills)

1. No centralized search budget/policy (Phase 2) — ad-hoc caps in 4 different files.
2. No caching of search results at all (Phase 3) — `discoverLive`/`discoverProspects` never persisted a result, so the exact same query 30 minutes later always paid for a fresh call.
3. No `shouldSearch()` information-value gate (Phase 4) — opportunity/prospect discovery ran unconditionally every cycle.
4. No purpose-driven provider selection (Phase 9) — Tavily always won if configured.
5. No hard daily/monthly/per-entity budget guards (Phase 10) — only per-cycle caps, so cost scaled linearly and unboundedly with uptime.
6. No survival-status-aware search throttling (Phase 11) — an AT_RISK or CRITICAL agent searched exactly as much as an ALIVE one.
7. No search-cost analytics anywhere (Phases 6, 14, 15) — no funnel conversion rates, no search ROI, no economic-efficiency dashboard.
8. No dedicated Human Action Queue surfacing offers-awaiting-send, payments-waiting-to-be-recorded, or stale-status prospects as first-class queue items (some of this existed implicitly in `recommendedActions`, but not the payment/status-update items specifically).

Everything above is what Phases 2–15 of this overhaul actually build. See `docs/SURVIVAL_AI_ECONOMIC_MODEL.md` for the before/after numbers and the exact implementation.

## 6. Deployment safety review (Phase 18)

- **`.github/workflows/deploy.yml`**: runs `npm install` then `npm run worker:deploy` (`tsc --noEmit && wrangler deploy worker/src/index.ts --config worker/wrangler.toml`) on push to `main`. **It does not run any `wrangler d1 execute` migration step at all** — the previously-flagged bug ("migration-apply step ran `wrangler d1 execute` from the repo root without `--config worker/wrangler.toml`") **does not exist in the current workflow file**. Every migration (0001–0011) is applied manually, by design, per the explicit instructions in `worker/wrangler.toml`'s header comment. This is actually the safer posture the spec asks for ("Do NOT automatically execute destructive production migrations") — no change was needed here.
- **D1 binding**: `worker/wrangler.toml` binds `DB` to database `survivor-ai` (`d4b6f436-1a2c-4f80-86a5-3c1717408d96`), matched by `worker/src/env.d.ts`'s `Env.DB: D1Database` and `worker/src/index.ts`'s `buildEngine()` (throws a clear error if `DB_BACKEND=d1` but the binding is missing) — correct.
- **Cron**: `[triggers] crons = ["*/30 * * * *"]` — matches the documented "every 30 minutes" cadence.
- **Secrets**: `TAVILY_API_KEY`, `BRAVE_API_KEY`, `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `TRIGGER_SECRET`, `SUPABASE_SERVICE_ROLE_KEY` are all set via `wrangler secret put`, never in `[vars]`, never returned by `/health` or `/state` (both only return connection booleans). Confirmed by reading `worker/src/index.ts` end to end — no secret value is ever serialized into a JSON response.
- **Frontend and API keys**: the deployed Worker never sends secrets to the browser. The **local-only** browser demo mode (`src/store.ts`, active only when `VITE_API_BASE_URL` is unset) does read `VITE_TAVILY_API_KEY`/`VITE_BRAVE_API_KEY`/`VITE_ANTHROPIC_API_KEY`/`VITE_OPENAI_API_KEY` client-side — this is by explicit design (`.env.example`'s own comment: "VITE_ vars are exposed to the browser — only ever put ANON/SEARCH keys here, never service-role keys") for the standalone offline demo, and the moment a backend URL is configured, `guardLocalMutation()` disables every local-mutation code path including the local search/LLM calls. **Recommendation, not a code change**: never set `VITE_TAVILY_API_KEY`/`VITE_BRAVE_API_KEY` in the production frontend's build environment — only in a fully local, un-deployed dev checkout, if the standalone demo is used at all.
- **New migration in this overhaul**: `migrations/0011_search_economy.sql` adds one small, additive `kv_store` table (`CREATE TABLE IF NOT EXISTS`), used to persist the search-budget/cache ledger across cron invocations. It is **not** wired into `deploy.yml` (consistent with every other post-baseline migration) and must be applied manually once:
  ```
  npx wrangler d1 execute survivor-ai --file=./migrations/0011_search_economy.sql --remote
  ```
  It was not executed by this audit/implementation session — no destructive or even additive production migration was run. `supabase/schema.sql` was updated with the equivalent `kv_store` table for the legacy Supabase fallback path (not applied to any live Supabase project by this session either).
