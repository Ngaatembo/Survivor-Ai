# SURVIVE AI — Status & Path to Real Revenue

**As of:** September 15, 2026
**Purpose:** a working reference for what's done, what's live, and what remains before this project can generate real income — so you can hand out or prioritize the remaining work.

---

## -6. Survivor 2.0, Phase 1 — Survival Core (COMPLETE, this session)

The user shared a larger "Economic Survival Agent" vision document. Per that document's own advice (§26 — don't build every strategy at once, start with the smallest real loop), this session built only **Phase 1: Survival Core** — the rest (action-approval workflow, strategy performance tracking, economic experiments, survival runs) remains future work.

- **`AgentStatus` extended with a `CRITICAL` tier** — `ALIVE → AT_RISK → CRITICAL → DEAD`, matching the document's ALIVE/LOW_FUNDS/CRITICAL/DEAD ladder (kept the existing `AT_RISK` name rather than a bigger rename). The three places that used to compute this inline and separately are now one shared `computeSurvivalStatus()` helper.
- **Mission ladder** (`src/lib/missions.ts`) — 5 structured survival milestones (first dollar of profit → +25% → 2x → 5x → 10x starting capital), replacing the freeform `Agent.currentObjective` string. **Deliberately scaled relative to actual starting capital** rather than the document's flat $1/$10/$25/$50/$100 figures, since the production agent already starts at $50 and those flat targets would already be exceeded on cycle 1 — the smoke suite explicitly verifies the ladder never uses hardcoded dollar figures.
- Wired into the cycle: the ladder generates once on first seed, gets evaluated against the real simulated balance every cycle, and completed missions get logged with a recorded lesson.
- **Dashboard**: the existing Survival Meter now shows the current mission and its target alongside the balance meter.
- New D1 migration `0010_missions.sql` (fully idempotent) + Supabase schema.

Verified: a new smoke suite (`scripts/missions.smoke.ts`, all passing — target scaling across different starting capitals, in-order completion, lessons/timestamps recorded, never reverting a completed mission, repository round-trip), all 10 smoke suites passing together, clean `tsc --noEmit` on both tsconfigs, clean `vite build`, and a live integration pass against real local D1 confirming the ladder generates with correctly-scaled targets on first seed.

**What remains for this to matter in practice:** nothing — this is purely internal state/UI, already active on every cycle. The rest of the Survivor 2.0 vision (Phases 2-6: decision engine reframing, action-approval workflow, strategy performance tracking, economic experiments, survival runs) is real, substantial future work, not yet started.

---

## -5. Real market pricing (COMPLETE, this session)

Fixed a real, substantive flaw flagged directly by the user: offer prices (e.g. $16 for a website) were never grounded in what the market actually charges — they came from a bare formula (`modeled monthly revenue ÷ 4 assumed engagements`, floor of just $5) with no connection to real going rates.

- **`src/services/marketPricing.ts`** — runs real live searches for actual going rates for a service in a region, then either has the real LLM synthesize a price range strictly from real figures found in those results (never from theory/general knowledge), or — with no LLM connected, or the call fails — falls back to an honest $0 "not enough evidence" digest, never a fabricated number.
- **`generateOffer()` now prefers the real researched price** over the old formula guess, but *only* when the research is genuinely confident (LLM-synthesized, non-LOW confidence) — a LOW-confidence or unsynthesized digest never overrides pricing. Every offer now carries a visible `priceRationale` explaining exactly why it's priced the way it is, shown in the Prospect Drawer.
- **Wired into the cycle**: before drafting any offer, the agent researches real market pricing for that opportunity once (cached per opportunity, not re-researched every cycle).
- New D1 migration `0009_market_price_research.sql` (new table + a one-time `offers.price_rationale` column addition) + Supabase schema.

Verified: a new mock-provider smoke suite (`scripts/marketPricing.smoke.ts`, all passing) demonstrates the exact fix concretely — the old formula guessed $80 for a sample opportunity; real market research (mocked freelancer quotes of $120-$250 in Harare) corrected it to $185. All 9 smoke suites pass together, clean `tsc --noEmit` on both tsconfigs, clean `vite build`, and a live integration pass against real local D1 confirmed the new `price_rationale` column persists correctly end-to-end (falls back safely to the formula price when no live search/LLM connector is available, exactly as designed).

**What remains for this to matter in practice:** requires live search + LLM to be connected (both already are in your production backend) — the very next offer drafted for a real prospect should be priced from genuine market research rather than the old formula.

---

## -4. Phase 3 (deepened) — Real working demo pages (COMPLETE, this session)

"Here's what YOUR website could look like" — an actual, working single-page demo per prospect, not just a written brief.

- **`src/lib/demoGenerator.ts`** — builds a real, self-contained HTML page: a category-based color palette (not a generic corporate-blue template), real sections (hero/about/services/gallery/contact) driven by the offer's website brief, personalized headline/services/about copy when confident (LLM-synthesized, non-LOW-confidence) deep research exists, honest labeled photo placeholders (never a stock photo passed off as real), and a real working WhatsApp/phone/email contact link built from the prospect's own contact info. Every page carries a visible "DEMO — not the business's official site" disclaimer.
- **Wired into the cycle**: a demo is built automatically the moment an offer is drafted, alongside the design brief.
- **`GET /demo/{prospectId}`** — serves the actual page as real HTML; this is the shareable link. **`POST /prospects/demo`** — manually regenerate one on demand.
- **Dashboard**: "Build demo" / "View demo" / "Rebuild demo" buttons in the Prospect Drawer. In live-backend mode, "View demo" opens the real backend URL; in the standalone browser demo (no backend), it opens a local Blob URL built from the same HTML, since there's no server to serve it from there.
- New D1 migration `0007_prospect_demos.sql` (fully idempotent) + Supabase schema.

**A real, important bug found and fixed during this build**: `prospect_interactions.kind`'s database CHECK constraint was never updated when `OFFER_DRAFTED`/`PROJECT_STARTED` (Phase 3) or `INTELLIGENCE_GATHERED` (Phase 6) were added to the app's type — every attempt to log one of those interaction kinds has been silently failing with `SQLITE_CONSTRAINT` since Phase 3 shipped. This was dormant only because no prospect had reached INTERESTED status yet in production; it would have broken the moment one did. Fixed going forward in `schema.d1.sql` and migration `0003`; **migration `0008_fix_prospect_interaction_kinds.sql` fixes your existing live table** (SQLite can't `ALTER` a CHECK constraint, so this safely rebuilds the table, preserving all existing rows) — **this one needs to be run once, manually, like 0005/0006/0007.**

Also fixed: migration `0004`'s `offers` table was missing the `opportunity_name` column in the migration *file* (production only had it because you added it manually via the D1 console earlier) — corrected so a fresh install now matches production exactly.

Verified: a new smoke suite (`scripts/demoGenerator.smoke.ts`, all passing — generic honest fallback, genuine personalization at confidence, LOW-confidence and snippet-digest content never trusted for customer-facing copy, real working contact links, repository round-trips), all 7 smoke suites passing together, clean `tsc --noEmit` on both tsconfigs, clean `vite build`, and a full live integration pass against real local D1 — a real demo was generated and served as actual HTML with the correct category palette and real business name, and the interaction-logging bug was caught, fixed, and re-verified working end-to-end.

**What remains for this to matter in practice:** exactly the same as every other phase — it activates the moment a real prospect reaches INTERESTED and gets an offer, which starts with you updating a real prospect's status in the CRM.

---

## -3. Phase 6 — Prospect Intelligence (deep research) (COMPLETE, this session)

Answers "why would THIS specific business pay us?" using real, live research — not the generic category-level evidence used elsewhere. This also activates a capability (`analyzeProspect`/the LLM connection) that existed in the codebase but was never actually being called — outreach and offers were previously template-only even with an LLM key connected.

- **`src/services/prospectIntelligence.ts`** — runs 3 targeted live searches naming the actual business (name+location, reviews/services, category+location competitors), then either has the real LLM synthesize a report strictly from those snippets, or — if no LLM is connected, or the call fails/returns unusable JSON — falls back to an honest raw-snippet digest. Never fabricates a fact the snippets don't support; the LLM prompt explicitly enforces this and every report carries its sources.
- **New `ProspectIntelligence` type**: businessOverview, apparentServices, socialPresenceSummary, competitiveNote, specificProblemEvidence, recommendedAngle, confidence (HIGH/MEDIUM/LOW), generator (llm/snippet-digest), sources.
- **Wired into the autonomous cycle**: runs automatically on your top 3 highest-value engaged prospects each cycle (capped to bound API cost), only when live search is connected.
- **`POST /prospects/research`** — manually trigger deep research on one specific prospect right now, instead of waiting for the capped auto-cycle. Shown as a "Research now" button in the Prospect Drawer.
- **Offers and outreach messages now genuinely use this research**: `generateOffer`'s gap analysis and `generateOutreachMessages`' opener both fold in the report's specific findings — but only when it's LLM-synthesized (not an unsynthesized digest) and at least MEDIUM confidence, so a customer never sees raw, unvetted digest text.
- Persisted across all 4 `EngineRepository` implementations + new D1 migration `0006_prospect_intelligence.sql` (fully idempotent, `CREATE TABLE IF NOT EXISTS`) + Supabase schema.
- New Deep Research section in the Prospect Drawer showing the full report, confidence, generator, and expandable sources.

Verified: a new mock-provider smoke suite (`scripts/prospectIntelligence.smoke.ts`, all passing — the no-results case, the no-LLM digest case, the LLM-synthesized case, the LLM-fails-falls-back-to-digest case, and that offers/outreach only trust confident synthesized reports), all 6 smoke suites passing together, clean `tsc --noEmit` on both tsconfigs, clean `vite build`, and a live integration pass against real local D1 — a full cycle ran cleanly with the new step as a no-op (no search connected in the test environment), and `/prospects/research` correctly returned a graceful, honest error rather than crashing or fabricating a report.

**What remains for Phase 6 to matter in practice:** this activates the moment your live search finds real prospects worth deep-researching — which, per your own database counts, is now (128 real prospects on record). The next 3 highest-value ones will get research automatically on the next cycle, or you can trigger it manually right now from the Prospect Drawer.

---

## -2. Phase 5 — Intelligence (COMPLETE, this session)

Everything below improves logic that already existed, using the real-world data Phase 4 collects. No new subsystem, no black-box model — every adjustment is a small, bounded, explainable blend between the modeled estimate and the real-world track record, and only ever kicks in once there's enough real data to be more than noise (3+ decided prospects for a category).

- **`lib/realRevenue.ts`**: `blendWithReal()` — the one generic blending rule used everywhere below (real-world weight starts at 0 below 3 samples, grows 0.15/sample, caps at 0.6 — the model always keeps some say). `computeCategoryRealWorldStats()` — real close rate, avg time-to-revenue, avg deal value per opportunity category, computed fresh from prospects (WON/LOST) + real_revenue each time.
- **§18 (scoring)**: `scoreOpportunity()` and `realRevenueScore()`/`evaluateOpportunity()` now blend real close-rate and real time-to-revenue into the `successProbability`/`speedToRevenue` factors that feed both the dashboard score breakdown and the KILL/ITERATE/SCALE decision — alongside (not replacing) Phase 4's price/time learning-event multiplier. Both fully backward compatible (optional params).
- **§19 (opportunity memory)**: `foldRealRevenueIntoMemory()` now also surfaces objections/notes text and a running "this category's real close rate is X% across N decided prospects" line directly in `agent_memory` — and because that same real close rate now feeds into `scoreOpportunity()`, a category with a real-world track record of losing naturally scores lower and is naturally deprioritized in opportunity selection, without needing to touch the (simulated-evidence-gated) lifecycle state machine.
- **§20 (prospect ranking)**: `scoreProspect()` blends `probabilityOfClose` with the category's real close rate (still capped at the existing conservative 35% ceiling), adding an explanatory factor string when the blend actually applies. Wired through `discoverProspects()` so newly-discovered prospects benefit immediately.
- **§21 (action prioritization)**: `computeRecommendedActions()` applies a bounded (0.6x-1.6x) real-world weight to `CONTACT_PROSPECT`/`FOLLOW_UP_PROSPECT`/`SEND_OFFER` expected values — this is the ranking-time catch-up for prospects scored before real data existed, since §20's blend only affects newly-scored ones.
- **§22 (visible improvement)**: new "Prediction error over time" chart in the Analytics view — a rolling average of `|price prediction error|` across recorded outcomes, oldest to newest, so whether predictions are actually getting closer to reality is visible, not just asserted.

Verified: a new pure-function smoke suite (`scripts/intelligence.smoke.ts`, all passing — blend bounds, category-stats computation, backward compatibility of every extended function, and directional correctness of every nudge), all 5 smoke suites passing together, clean `tsc --noEmit` on both tsconfigs, clean `vite build`, and a live integration pass — 2 full cycles against a real local D1 with zero real-world data (confirming every blend is a true no-op until 3+ decided outcomes exist), then a live test with 2 WON + 1 LOST prospect and one real-revenue entry in a category, confirming the opportunity's `successProbability`/`speedToRevenue` score factors visibly shifted from their modeled baseline.

**What remains for Phase 5 to matter in practice:** same pattern as Phases 3/4 — every blend requires 3+ real decided outcomes in a category before it does anything, so this activates once real prospects have been won and lost at some volume.

---

## -1. Phase 4 — Real Revenue (COMPLETE, this session)

Built, verified, and (pending final push) ready for production:

- **Real revenue ledger** (`real_revenue` table) — a completely separate, append-only actual-money record: date, opportunity, prospect, project, product/service, quoted price, amount received, costs, profit, currency, payment method, acquisition channel, discovery-to-payment time, notes. Never mixed with the simulated wallet.
- **Write path**: `POST /real-revenue` — narrow, single-table, human-entered, never called by the autonomous loop. `POST /projects/outcome` extends it with satisfaction (1-5), repeat purchase, and referral on the delivery project.
- **Feedback learning** (`src/lib/realRevenue.ts`, `learning_events` table): every real-revenue entry immediately generates one learning event comparing predicted price/time-to-revenue to actual, and folds a `[REAL]`-tagged note into the *existing* `agent_memory` system (opportunity + category level) — verified that this never touches the simulated `tests`/`spent`/`revenue`/`conclusion` fields real money is never mixed with simulated economics.
- **v1 rule-based scoring adjustment** (`realWorldScoreAdjustment`): once a category has 2+ real outcomes, `realRevenueScore()`/`evaluateOpportunity()` apply a small, explainable multiplier (0.7x if real results run ≥30% below prediction, 1.2x if ≥30% above, 1.0x otherwise) — never a black-box model, and never acts on a single data point.
- **Simulation-vs-reality analytics** — a new **Analytics** dashboard view: per-opportunity and aggregate comparison of predicted vs. actual price/time-to-revenue, with an honest empty state (not fabricated numbers) until real data exists.
- Persisted across all four `EngineRepository` implementations; new D1 migration `0005_real_revenue.sql` and matching Supabase schema.

Verified: a pure-function + repository smoke suite (`scripts/realRevenue.smoke.ts`, all passing), a clean `tsc --noEmit` on both tsconfigs, a clean `vite build`, all four smoke suites passing together, and a live integration pass against a real local D1 — `/real-revenue` correctly computed profit and generated a learning event comparing the *real* opportunity's predicted price ($80) to the actual amount received ($150, +87.5%); `/projects/outcome` persisted satisfaction/repeat/referral; `/state` correctly exposed all of it; and the memory fold confirmed real money never touched the simulated `tests`/`spent`/`revenue` counters.

**Note on migration mechanics:** unlike 0004 (pure `CREATE TABLE IF NOT EXISTS`, safe to re-run), 0005 includes bare `ALTER TABLE ... ADD COLUMN` statements for the three new `projects` outcome columns — SQLite has no `ADD COLUMN IF NOT EXISTS`, so this one is **not** wired into the CI auto-migration step and must be applied once, manually:
```
npx wrangler d1 execute survivor-ai --file=./migrations/0005_real_revenue.sql --remote
```

**What remains for Phase 4 to matter in practice:** same as Phase 3 — none of it activates until real prospects, offers, and delivered projects exist and a human starts recording actual payments.

---

## 0. Phase 3 — Offer + Delivery (COMPLETE, this session)

Built, verified, and pushed:

- **Offer generation** (`src/lib/offerGenerator.ts`) — turns an engaged prospect + its opportunity's business model into a priced package (price, timeline, deliverables) and a full website brief. A gap analysis is included only when the prospect's own website-presence evidence actually supports one.
- **Design brief generation** (`src/lib/designBriefGenerator.ts`) — homepage concept, hero section, logo direction, social graphics for every drafted offer. No image-generation integration is wired in, so `assetStatus` stays `NOT_CONFIGURED` — briefs are complete and human-usable regardless.
- **Delivery project tracking** (`src/lib/projectTracker.ts`) — a project with 6 standard milestones (KICKOFF → CONTENT_COLLECTED → DESIGN_APPROVED → BUILD → REVIEW → DELIVERED) is created automatically the moment a prospect is marked WON.
- **CRM + write paths**: `POST /prospects/status` (record real-world outcomes — the only way a prospect advances past QUALIFIED), `POST /offers/status` (mark an offer sent/accepted/declined), `POST /projects/milestone` (advance delivery).
- New `agent_actions` kinds: `SEND_OFFER` (a drafted-but-unsent offer) and `ADVANCE_PROJECT` (next incomplete milestone, urgency escalates when overdue).
- Persistence across all four `EngineRepository` implementations (D1, Supabase, InMemory, browser Store), a new **Delivery Projects** dashboard view, and offer/design-brief/project display + status controls in `ProspectDrawer`.
- New D1 migration `0004_offer_delivery.sql` (applied automatically by `.github/workflows/deploy.yml`, same pattern as 0001–0003) and matching Supabase schema additions.

Verified: a pure-function/repository smoke suite (`scripts/offerDelivery.smoke.ts`), a clean `tsc --noEmit` on both tsconfigs, a clean `vite build`, and a live integration pass — a real `wrangler dev` Worker against a real local D1, run through several cycles: an INTERESTED prospect correctly got an auto-generated offer + design brief tailored to its actual category, marking it WON auto-created a delivery project with the offer's real price/timeline, and `/projects/milestone` correctly advanced KICKOFF → CONTENT_COLLECTED.

**What remains for Phase 3 to matter in practice:** same as before — it activates once real prospects exist and a human is recording outcomes through the CRM.

---

## 1. What's been covered

### The backend was completely non-functional — now it isn't
The core bug: every single write to the database failed silently since the day the backend was first deployed. The agent, wallet, opportunities — every table stayed empty no matter how many times the cron job fired. This was fixed, tested locally through 12 real cycles, and — as of tonight — **verified against production**: cycle #1 ran for real, balance moved from $50.00 to $92.98, and the result was written to the live database.

### Three safety mechanisms were hardened
- The 18%-per-cycle spending cap can no longer be exceeded, even at very low balances (a bug that used to let it overspend at low balances is closed).
- Two cron ticks (or a cron tick and a manual trigger) can no longer run at the same time and double-spend — there's now a proper lock.
- A second real bug (writing a ledger entry before the row it referenced existed) was found and fixed during testing.

### The frontend and backend are now connected
Previously the dashboard and the real backend had no relationship — the dashboard only ever showed local demo data. There's now a live-data mode: when configured, the dashboard polls the real backend every 15 seconds and shows the actual agent, wallet, and activity — no fabricated numbers.

### Deployment pipeline is fixed and now automatic
Getting code from "written" to "live" was blocked for most of tonight — first by this chat session having no GitHub access, then by your phone's Termux being unable to run Cloudflare's deploy tool (an Android/ARM64 platform limitation, not fixable on-device), then by a worker-naming mismatch that caused a deploy to silently create a decoy worker instead of updating the real one. All three are now resolved: **GitHub Actions deploys the worker automatically on every push to `main`**, no phone, laptop, or Termux required going forward.

### Confirmed live right now
- Production database: was completely empty, now has one real completed cycle in it.
- `survivor-ai-backend` worker: running the correct, fixed code.
- Cron: fires every 30 minutes on its own from here on.
- Live search + LLM connectors: confirmed active (not just simulated fallback).

---

## 2. The one thing to understand about "making money" from this

This system is a **research and validation sandbox by design** — it hard-blocks real trading or real payment execution in the code itself, as a safety rule, not a missing feature. It will never autonomously spend or collect real money. What it *can* do, and just proved it can do, is test business ideas against a simulated market and tell you which ones look worth pursuing for real.

So the path to real income runs through two separate tracks, not one:

---

## 3. Track 1 — Acting on what the research already tells you (no code needed)

The first validated result: **"AI-assisted website service for local businesses"** — modeled at very low cost, high simulated return. That's a lead, not proof. The fastest real path to actual money is you (or someone) picking a validated idea like this and pursuing one real customer manually — a local business, a small pilot offer, real payment via your own bank/EcoCash/etc. This can start in parallel with everything below and doesn't wait on any further building.

**Left to do:** let the loop run for a few more days to build up more than one data point, then review the ranked list of validated ideas together and pick one to test with a real person.

---

## 4. Track 2 — Building the commercial layer (the actual remaining engineering work)

This is the part of the original build plan that was explicitly deferred tonight, because it only makes sense on top of a backend that actually persists data — which it now does. In priority order:

1. **Business-model output per opportunity.** Right now the agent scores and simulates an idea, but doesn't yet output a concrete "here's what to sell, to whom, at what price, through what channel." This is the single highest-leverage next step — it converts a score into an actionable pitch.

2. **Opportunity portfolio states.** Add explicit status tracking per idea — DISCOVERED → VALIDATING → PROVEN → SCALING → FAILED/ARCHIVED — so it's immediately visible which ideas have earned more attention and which should be dropped. The underlying learning/memory system already exists; this adds a visible label on top of it.

3. **Prospect/customer tracking.** A lightweight CRM-style layer: log real people or businesses you've contacted about a validated idea, their status (contacted / interested / paying), and outcomes. This turns "the AI found an idea" into "here's who to call next."

4. **KILL/ITERATE/SCALE decision logic.** Formal rules for when the agent should recommend abandoning an idea (repeated failures), doubling down (repeated success — already partially working via strategy shifts), or trying a variant.

5. **A simple real-world revenue log**, separate from the simulated wallet — a place to record what you *actually* earned by acting on a validated idea, so over time you can compare "the simulation predicted X" against "reality delivered Y" and make the model more trustworthy.

None of this touches real payments or automates outreach — it's decision-support, built to make Track 1 faster and better-informed.

---

## 5. Suggested order of work

1. Let the current loop run 24–48 hours to get more than one validated idea (no action needed from you, it's automatic now).
2. I build item 1 above (business-model output) — the fastest to ship and the most directly useful.
3. We review the first few validated ideas together and you start a real pilot with one (Track 1), while I continue building items 2–4.
4. Add the real-world revenue log once you have at least one real result to record.

Tell me which of these to start on first, or if you'd rather reprioritize.

<!-- frontend rebuild trigger: VITE_API_BASE_URL added to survivor-ai Cloudflare project, 2026-09-15T05:31:55Z -->
