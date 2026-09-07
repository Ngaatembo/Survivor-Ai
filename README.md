# SURVIVE AI — Autonomous Economic Research Laboratory (v0.1 prototype)

> **The question this prototype answers:** if an AI has **$50 of simulated capital** and no
> predefined business model, can it research legitimate income opportunities, evaluate them
> objectively, select the strongest, simulate an experiment, measure the result, remember the
> outcome, and improve its next decision?

**Everything involving money is simulated.** No real money, trading accounts, bank accounts,
crypto wallets, payment accounts, or financial APIs are connected. Finance categories
(forex, crypto, prediction markets) are research-only and blocked from autonomous execution.

## Run

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build
```

## The autonomous loop

```
RESEARCH → DISCOVER → VERIFY → SCORE → RANK → SELECT → SIMULATE → MEASURE → LEARN ↺
```

Controls in the top bar: **START RESEARCH** (continuous autonomous looping), **PAUSE AGENT**,
**RUN NEXT CYCLE** (one full loop), **RESET SIMULATION**.

## Architecture

```
src/
├── types.ts                 # Domain models — mirror Supabase tables 1:1
├── data/sampleData.ts       # SAMPLE seed knowledge base (clearly labelled, 30+ models)
├── lib/
│   ├── scoring.ts           # Deterministic 0–100, 9 weighted factors, auditable breakdown
│   ├── simulation.ts        # Experiment simulation engine (probability/risk/memory-adjusted)
│   └── format.ts
├── services/                # ← clean abstractions; APIs plug in here later
│   ├── connectors.ts        # Registry: Claude, OpenAI, Search, Browser, Payments… all NOT CONNECTED
│   ├── research.ts          # discover() / verify() / score() / rank() — KB now, live APIs later
│   ├── ai.ts                # decide() + generateReport() — rule engine now, LLM later
│   ├── wallet.ts            # Append-only ledger; balance derived, never mutated directly
│   ├── memory.ts            # Per-opportunity & per-category learning that biases decisions
│   └── experiments orchestration via store.ts loop
├── store.ts                 # Zustand store + autonomous cycle runner (persisted to localStorage)
└── components/              # Command Center, Research Engine, Explorer, Decision Center…
supabase/schema.sql          # Target Postgres schema: 11 normalized tables, enums, RLS
```

### Connecting real APIs later
Each external capability sits behind a service interface and a `connectors.ts` entry marked
**NOT CONNECTED**. Attaching an API = implementing the same interface + flipping the flag —
no UI or decision-logic changes. Real-money functionality is designed behind explicit
authorization, spending limits, approval gates and audit logs (see `real_money_approvals`
notes in the schema), and stays off by default.

### SAMPLE vs LIVE
Seed records are tagged `dataSource: 'SAMPLE'` and badged everywhere. Live research results
will be tagged `LIVE` once the search/browser connectors exist. The UI never presents seed
data as live fact; every figure carries an evidence tier (VERIFIED / LIKELY / UNCERTAIN /
UNVERIFIED).

## Safety controls
- 100% simulated ledger; no payment/trading connector exists.
- Finance models are classified RESEARCH ONLY.
- Experiments capped at ≤18% of simulated balance per cycle.
- Balance < $5 → **AT RISK**; balance = $0 → **DEAD** (read-only, experiments locked, resettable).
