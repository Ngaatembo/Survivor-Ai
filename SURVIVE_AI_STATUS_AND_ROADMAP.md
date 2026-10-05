# SURVIVOR AI — Economic Survival Direction, Status & Roadmap

**As of:** October 5, 2026

## 0. What Survivor is

Survivor is an **economic survival agent**.

Its job is not to be a WebAura sales bot, a website-business assistant, or a single monetization strategy. Its job is to continuously:

1. discover legitimate economic opportunities;
2. understand the customer, market, problem, offer and route to revenue;
3. estimate expected value, probability of success, speed to revenue, upfront cost, repeatability, complexity and risk;
4. compare competing opportunities against the agent's current capital and survival status;
5. choose the cheapest meaningful experiment when uncertainty is high;
6. **TEST, KILL, ITERATE or SCALE** opportunities based on evidence;
7. plan safe next actions;
8. require human approval or an explicitly permitted execution path before consequential external actions;
9. record real costs and **verified real revenue** separately from simulation;
10. learn from real outcomes and feed those lessons back into future economic decisions.

The core loop is:

```
SURVIVOR
  ↓
Economic Brain
  ↓
Opportunity Discovery
  ↓
Opportunity Portfolio
  ↓
Economic Scoring
  ↓
TEST / KILL / ITERATE / SCALE
  ↓
Safe Action Planning
  ↓
Human-approved or explicitly permitted execution
  ↓
Real-world outcome
  ↓
Verified revenue / actual cost
  ↓
Learning + memory
  ↓
Economic Brain
```

### WebAura is a strategy, not Survivor's identity

**WebAura is one economic strategy Survivor can evaluate and pursue.**

Other legitimate strategies may include, for example:

- website services;
- automation services;
- lead generation;
- digital products;
- local business services;
- software products;
- other service businesses;
- other opportunities discovered and validated by the system.

Survivor must be able to compare these rather than assuming WebAura is always the answer.

The dashboard question should therefore be:

> **"What is the best economic move right now, given our capital, survival status, evidence and current opportunities?"**

—not simply:

> "Which WebAura prospect should we contact?"

## 1. Economic decision principles

Survivor should optimize for **survival first, then sustainable growth**.

Opportunity selection should consider, at minimum:

- expected profit/value;
- probability of success;
- speed to first revenue;
- upfront cash requirement;
- downside/risk;
- repeatability;
- complexity and execution effort;
- evidence quality;
- current survival status;
- available risk capital/runway;
- historical real-world performance of the strategy/category.

When capital is healthy, Survivor can tolerate larger experiments when their expected value justifies them.

When capital is constrained, Survivor should naturally favor opportunities that are:

- cheap to test;
- fast to revenue;
- supported by stronger evidence;
- reversible;
- less likely to threaten the survival runway.

No single strategy is permanently preferred merely because it worked once.

## 2. Opportunity portfolio

Every economic strategy/opportunity should be understandable as a portfolio item with a lifecycle such as:

```
DISCOVERED → VALIDATING → PROVEN → SCALING
                 ↓
              ITERATE
                 ↓
             FAILED / ARCHIVED
```

The portfolio should preserve:

- business model;
- target customer;
- problem;
- offer;
- acquisition/channel path;
- expected economics;
- experiments;
- actions;
- outcomes;
- real revenue/cost;
- lessons;
- current decision: TEST / KILL / ITERATE / SCALE.

A prospect is therefore an **execution object inside a strategy**, not the definition of the strategy itself.

## 3. Strategy comparison

Survivor should be able to place multiple strategies side-by-side and answer:

> Which opportunity should receive the next unit of attention/capital?

For example:

| Strategy | First revenue speed | Upfront cost | Probability | Repeatability | Risk | Decision |
|---|---:|---:|---:|---:|---:|---|
| WebAura websites | measured | measured | measured | measured | measured | TEST / SCALE / KILL |
| Automation service | measured | measured | measured | measured | measured | TEST / SCALE / KILL |
| Lead generation | measured | measured | measured | measured | measured | TEST / SCALE / KILL |
| Digital product | measured | measured | measured | measured | measured | TEST / SCALE / KILL |

These are examples of strategy categories, not hardcoded winners. Survivor should populate the evidence from actual discovery, experiments and outcomes.

## 4. Safety and money rules

The economic brain must sit **inside** the existing safety architecture, not around it.

The following remain non-negotiable:

- real money is separate from simulation;
- revenue counts only when independently verified;
- spending requires the existing authorization/safety chain;
- the kill switch remains authoritative;
- death/survival thresholds remain enforced;
- paid AI/search calls remain metered and bounded;
- uncertain payment outcomes never become revenue;
- no autonomous outreach, publishing, trading or payment execution is introduced merely to improve economic performance;
- a strategy cannot spend beyond available risk capital;
- every consequential action must have an auditable reason and outcome.

The goal is not "autonomy at any cost." The goal is **better economic decisions under survival constraints**.

## 5. Existing foundation

Survivor already contains substantial pieces of this direction.

### Survival and treasury

The repository contains:

- real treasury / truthful ledger work;
- survival states and survival-aware ranking;
- mission/progress tracking;
- spend authorization and kill-switch controls;
- separate real-world revenue tracking;
- real-cost and verified-revenue handling.

### Economic intelligence

The repository also contains:

- opportunity discovery;
- business-model generation;
- market pricing research;
- prospect intelligence;
- opportunity scoring;
- real-world performance blending;
- prediction-vs-actual learning;
- opportunity memory;
- KILL / ITERATE / SCALE decision logic;
- strategy performance analytics.

### Commercial execution

The commercial layer contains:

- offer generation;
- prospect/customer tracking;
- working demos;
- delivery/project tracking;
- real revenue recording;
- payment verification paths.

These capabilities should be composed into the **Economic Opportunity Engine** rather than rebuilt as separate WebAura-specific systems.

## 6. Current WebAura revenue loop

The current revenue-first implementation is useful but must remain a **strategy implementation**, not the core identity of Survivor.

WebAura can provide:

- a concrete first-dollar strategy;
- local-business prospect discovery;
- personalized website offers;
- demo generation;
- human-approved WhatsApp outreach;
- payment-request preparation;
- verified payment recording.

The generic economic engine should decide **when WebAura deserves attention relative to other opportunities**.

## 7. Roadmap

### Phase A — Economic Opportunity Engine

Unify the existing opportunity, scoring, business-model, memory, experiment and real-revenue capabilities behind one generic strategy interface.

Required capabilities:

1. strategy registry;
2. opportunity portfolio;
3. economic scoring;
4. strategy comparison;
5. experiment planning;
6. TEST / KILL / ITERATE / SCALE decisions;
7. safe action queue;
8. outcome recording;
9. real revenue/cost reconciliation;
10. learning back into strategy/opportunity scores.

### Phase B — Strategy expansion

Keep WebAura as the first concrete strategy, then add additional legitimate strategies one at a time.

Each strategy must use the same economic interface and safety rules.

Do not build a large collection of speculative strategies before the generic engine can measure real outcomes.

### Phase C — Evidence-driven allocation

Use real outcomes to change strategy priority.

A strategy that repeatedly fails should lose priority.

A strategy that produces verified revenue efficiently should gain priority.

A strategy with insufficient evidence should be tested cheaply rather than treated as proven.

### Phase D — Economic survival loop

The mature loop becomes:

```
DISCOVER
  ↓
COMPARE
  ↓
SELECT
  ↓
TEST
  ↓
MEASURE
  ↓
KILL / ITERATE / SCALE
  ↓
LEARN
  ↺
```

The system should continuously answer:

> **What is the best economic move Survivor can safely make next?**

## 8. Current status

The repository has already demonstrated important parts of the foundation, including survival-aware decision making, real-world revenue tracking, market/prospect intelligence, business-model and offer generation, and commercial workflows.

The immediate architectural gap is **not another WebAura feature**.

The immediate gap is to connect these capabilities into a genuinely **strategy-agnostic Economic Opportunity Engine**.

PR #69 ("Revenue-first loop: first-dollar WebAura pipeline") is therefore treated as an implementation step that must be reviewed/refactored against this broader architecture before it is merged.

## 9. Historical direction

The project history contains earlier work expanding Survivor's discovery beyond NWT Dev/WebAura and building commercial/economic concepts such as:

- business-model output per opportunity;
- opportunity portfolio states;
- prospect/customer tracking;
- KILL / ITERATE / SCALE;
- real-world revenue logging;
- survival-aware opportunity ranking;
- strategy performance.

Those historical capabilities are part of Survivor's intended direction and should be reused where appropriate rather than duplicated.

## 10. Working rule for future development

Before adding a new monetization feature, ask:

> **Does this make Survivor better at discovering, comparing, testing, executing safely, measuring and learning from economic opportunities?**

If the answer is only:

> **"It makes WebAura better,"**

then it belongs inside the WebAura strategy layer—not automatically inside Survivor's core.

---

**Bottom line:** Survivor is being built as an **economic survival agent**, with WebAura as its current concrete first-dollar strategy. The long-term objective is a system that can discover legitimate opportunities, compare them under real survival constraints, run cheap experiments, learn from verified outcomes, and continuously choose the best next economic move.
