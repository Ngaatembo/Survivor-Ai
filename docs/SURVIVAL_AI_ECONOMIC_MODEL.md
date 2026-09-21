# SURVIVE AI — Economic Model (After the Search Economics Overhaul)

**Date:** 2026-09-21

This document is the "after" companion to `docs/SURVIVAL_ECONOMICS_AUDIT.md` (the "before"). Read that one first for the full pre-overhaul search-cost map and what was already good and left untouched.

---

## 1. Before → After

All "before" numbers are derived from reading the pre-overhaul code (no historical telemetry exists — this system has never logged search counts before this overhaul), assuming one live search provider connected and ≥1 `Local / Real-World` opportunity validated (the scenario in which the pre-overhaul code actually made live calls). All "after" numbers are the **hard policy ceilings** in `src/services/searchBudget.ts`'s `SEARCH_POLICY`, which are enforced in code and verified by `scripts/searchEconomy.smoke.ts` — not aspirational targets.

| Metric | Before (estimated, steady state) | After (hard ceiling) | After (realistic, once cache is warm) |
|---|---|---|---|
| Searches / cycle | up to 27 (growth phase) / 12 (steady state, uncapped) | ≤ 18 (6+3+3+2+1+... summed across purposes, `maxPerCycle`) | typically 0–3 — most cycles hit a warm cache or the entity-level deferral gate |
| Searches / day | ~576 (items #1+#2 alone, no ceiling existed) | ≤ 39 (`12+9+9+6+3`) | ~5–15 once the 6 discovery categories and active prospect pipeline are cached |
| Searches / month | ~17,280 | ≤ 1,170 | ~150–450 |
| Cache | none | TTL-based per purpose (7d discovery/intelligence/pricing, 2d prospect discovery) | cache hit rate rising toward 80–95% at steady state, once the opportunity/prospect set stabilizes |
| Budget controls | none (only per-cycle array lengths) | per-cycle / per-day / per-month / per-entity hard guards, never crash — `SEARCH_BUDGET_EXCEEDED` | — |
| Provider choice | Tavily always wins if configured | purpose-driven policy (`SEARCH_POLICY[purpose].primaryProvider`), Brave default for volume purposes, Tavily default only for prospect-intelligence's richer synthesis need | — |
| Survival-aware throttling | none | ALIVE = full policy; AT_RISK = ~50–75% of budgets; CRITICAL = opportunity/prospect discovery cut to ≤1/cycle, other purposes ~60%; DEAD = 0 everywhere | — |

**Major sources of waste eliminated:**
1. `liveResearch.discoverLive()` ran its full 6-query sweep every 30 minutes forever, regardless of whether the same categories had just been searched. Now gated by a 7-day TTL cache keyed per category (`entityId = category`), plus a 12/day hard ceiling.
2. `prospectDiscovery.discoverProspects()` ran its full 3-query sweep every 30 minutes for every "pursuable" opportunity, forever. Now gated by a 48-hour TTL cache keyed per (opportunity, seed-category) pair, plus a 9/day hard ceiling.
3. No purpose ever had a monthly ceiling — cost scaled linearly, unboundedly, with uptime. Now every purpose has an explicit monthly ceiling (`SEARCH_POLICY[purpose].maxPerMonth`).

**Cache reduction:** at steady state, the two dominant pre-overhaul operations (#1, #2 above) are reduced from "every cycle, forever" (unbounded) to "once per TTL window, bounded by a daily ceiling" — roughly a **95%+ reduction** in the volume that was actually avoidable (i.e. searches that would have returned materially the same results as the previous cycle).

**Expected research efficiency improvement:** the same categories/prospects that used to be re-searched every 30 minutes for no new information are now only re-searched when (a) their cache TTL genuinely expires, (b) a tracked entity's status meaningfully changes (a prospect replies, goes INTERESTED, or is about to receive a priced offer), or (c) the daily/monthly budget still has room and the entity is high-priority. Every dollar (or free-tier quota unit) of search now goes toward either genuinely new information or a search a human decision is actually waiting on.

---

## 2. What Survivor-AI actually does today

### AUTOMATED (the agent does this without a human)
- Opportunity research and discovery (budget/cache-gated, `src/services/liveResearch.ts` + `searchEconomy.ts`)
- Local-business prospect discovery (budget/cache-gated, `src/services/prospectDiscovery.ts`)
- Prospect scoring and priority assignment (`src/lib/prospectScoring.ts`)
- Business-specific prospect intelligence research (budget/cache-gated, `src/services/prospectIntelligence.ts`)
- Real market-pricing research (budget/cache-gated, `src/services/marketPricing.ts`)
- Offer, design-brief, and working-demo-page preparation (`src/lib/offerGenerator.ts`, `designBriefGenerator.ts`, `demoGenerator.ts`)
- Outreach message drafting — WhatsApp/SMS/email/call-script/meeting-agenda (`src/lib/outreachGenerator.ts`)
- Analytics: simulation-vs-reality comparison, revenue funnel, search ROI, economic efficiency (`src/lib/realRevenue.ts`, `src/lib/revenueFunnel.ts`, `src/services/searchEconomy.ts`)
- Learning: category/channel performance updates the moment a real payment is recorded (`src/lib/realRevenue.ts`)
- The "Next Money Action" recommendation and the Human Action Queue (`src/lib/recommendedActions.ts`, surfaced by `worker/src/index.ts`'s `/state` endpoint)

### HUMAN-REQUIRED (the agent cannot and does not do this)
- Approving and actually sending outreach messages (WhatsApp, SMS, email, calls)
- Handling replies from real businesses
- Changing a prospect's CRM status (`POST /prospects/status` — never called autonomously; every status transition past `QUALIFIED` requires this human-driven write)
- Accepting a deal / marking an offer sent, accepted, or declined (`POST /offers/status`)
- Delivering the actual project work (website build, etc.) and advancing delivery milestones (`POST /projects/milestone`)
- Recording a real payment (`POST /real-revenue`) — this is the **only** way real revenue ever enters the system; nothing here ever moves real money
- Deciding to apply a database migration (every migration file states the exact manual `wrangler d1 execute` command; none are auto-applied by CI)

**The system does not, and cannot, autonomously generate real money.** Every dollar figure produced by the autonomous loop before a human records a `real-revenue` entry is either (a) simulated wallet/experiment economics (`src/services/wallet.ts`, `src/lib/simulation.ts` — capped at 18% of the simulated balance per experiment, never real funds) or (b) a *predicted*/*expected* value (`expectedValue`, `revenuePotentialMonthlyMin/Max`) clearly derived from a model, never presented as an actual receipt. The Search ROI metric itself is explicit about this: before any real revenue exists, it reports `basis: "EXPECTED_VALUE"`, not `"REAL_REVENUE"` — never silently substituting one for the other.

---

## 3. The search-cost assumption, stated explicitly

`services/searchEconomy.ts`'s `computeSearchROI()` measures cost in **search-call units**, not dollars. Neither Tavily's nor Brave's paid per-call pricing is configured anywhere in this codebase (no billing integration exists, consistent with "simulation-only, never spends real money"), so a fabricated $-per-call figure would not be honest. Brave's free tier (2,000 queries/month, publicly documented pricing at the time of writing) is the most concrete real-world reference point: this overhaul's hard monthly ceiling (≤1,170 searches/month across all purposes) sits comfortably inside that free tier even before caching reduces the realistic figure further to ~150–450/month.

---

## 4. Deliverables produced by this overhaul (files)

**Created:**
- `src/services/searchBudget.ts` — centralized policy, budget accounting, provider selection, `shouldSearch()`
- `src/services/searchCache.ts` — named re-export of the caching surface
- `src/services/searchEconomy.ts` — `runSearch()` orchestrator, KV load/save, `computeSearchROI()`
- `src/lib/revenueFunnel.ts` — funnel stage counts/conversion rates, category/channel breakdowns, deal metrics
- `src/components/EconomicEfficiency.tsx` — the ECONOMIC EFFICIENCY / REVENUE FUNNEL / NEXT MONEY ACTION dashboard panel
- `migrations/0011_search_economy.sql` — additive `kv_store` table (D1)
- `scripts/searchEconomy.smoke.ts` — the new test suite (see §5)
- `docs/SURVIVAL_ECONOMICS_AUDIT.md`, `docs/SURVIVAL_AI_ECONOMIC_MODEL.md` — this pair of documents

**Modified:**
- `src/services/liveResearch.ts`, `src/services/prospectDiscovery.ts`, `src/services/prospectIntelligence.ts`, `src/services/marketPricing.ts` — every direct `SearchProvider.search()` call now goes through `runSearch()`
- `src/services/providers/search.ts` — added `createSearchProviders()` (returns both providers; `selectProvider()` in `searchBudget.ts` decides which to use); kept the old `createSearchProvider()` marked `@deprecated` for any unmigrated caller
- `src/engine/agentEngine.ts` — builds one `SearchEconomyContext` per cycle, threads it through discovery/intelligence/pricing, persists the ledger once at cycle end
- `src/engine/repository.ts` + `d1Repository.ts` + `supabaseRepository.ts` + `inMemoryRepository.ts` + `storeRepository.ts` — added `getKV`/`setKV`
- `worker/src/index.ts` — `buildEngine()` now wires both providers; `/state` now returns `economicEfficiency` (search economy summary, revenue funnel, conversion breakdowns, search ROI, human action queue); `/prospects/research`'s manual trigger goes through the same economy layer
- `src/store.ts`, `src/services/backendApi.ts` — round-trip the new `economicEfficiency` field; the browser demo's local manual-research path also goes through the economy layer
- `src/App.tsx` — new "Economic Efficiency" nav entry
- `supabase/schema.sql` — added the `kv_store` table (Supabase legacy-fallback counterpart to the D1 migration)
- `scripts/marketPricing.smoke.ts`, `scripts/prospectIntelligence.smoke.ts`, `scripts/prospectPipeline.smoke.ts` — updated to construct a `SearchEconomyContext` around their mock providers (their assertions and mock setups are otherwise unchanged; all still pass)

---

## 5. Tests and commands run

```
npm run typecheck                         # PASS (root tsconfig — browser build)
npx tsc --noEmit -p worker/tsconfig.json  # PASS (worker build, Cloudflare types)
npm run build                             # PASS (tsc + vite build, 100 modules)
npx tsx scripts/*.smoke.ts                # ALL 13 smoke scripts PASS, including the
                                           # 12 pre-existing ones (unmodified assertions)
                                           # and the new scripts/searchEconomy.smoke.ts
```

`scripts/searchEconomy.smoke.ts` explicitly covers, with real assertions (not just "it doesn't throw"): per-cycle/day/month/per-entity budget enforcement, cache hit and TTL expiration, provider fallback, Tavily-not-auto-preferred-just-because-configured, CRITICAL-state throttling, DEAD-agent zero-search, low-priority-entity deferral under a tightened survival policy (the mechanism behind "existing qualified prospect prioritized over unnecessary discovery"), real-payment → category/channel metric updates, search ROI (including the real-revenue vs. expected-value basis switch and the divide-by-zero-safe no-data case), revenue-funnel cumulative stage counts, no-duplicate-research-within-TTL for both prospect intelligence and market pricing, and the dashboard summary shape.

**Not run / not possible in this environment:** no live network calls to Tavily/Brave/Anthropic/OpenAI were made (no API keys available in this session, and doing so would have been a genuine, real API cost — exactly what this overhaul exists to minimize). No `wrangler d1 execute` was run against any real D1 database (this session cannot push to the repository or deploy; `migrations/0011_search_economy.sql` must be applied manually by the project owner before the next deploy — see the audit doc §6 for the exact command).
