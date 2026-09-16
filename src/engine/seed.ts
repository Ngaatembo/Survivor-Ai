/* ============================================================================
 * Seed-state factory — the canonical starting point used by the browser store,
 * the Cloudflare Worker's first run, and the Supabase seed script.
 * ========================================================================== */

import type {
  Agent,
  AgentEvent,
  Opportunity,
  Strategy,
  Transaction,
} from '../types';
import { SAMPLE_OPPORTUNITIES, INITIAL_DISCOVERY_IDS } from '../data/sampleData';
import { uid } from '../lib/format';
import { scoreOpportunity } from '../lib/scoring';
import { openingLedger } from '../services/wallet';
import { advanceStage, scoreAll, rankOpportunities } from '../services/research';
import { strategyFromMemory } from '../services/ai';

export const STARTING_CAPITAL = 50;
export const SURVIVAL_THRESHOLD = 5;
/** Below this, the agent is CRITICAL — closer to DEAD than merely
 *  AT_RISK (Survivor 2.0 §4's ALIVE/LOW_FUNDS/CRITICAL/DEAD ladder,
 *  named AT_RISK/CRITICAL here to keep the existing AgentStatus values). */
export const CRITICAL_THRESHOLD = 2;

/** The single source of truth for balance -> survival-status mapping —
 *  previously duplicated three times inline across agentEngine.ts. */
export function computeSurvivalStatus(balance: number): 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD' {
  if (balance <= 0) return 'DEAD';
  if (balance < CRITICAL_THRESHOLD) return 'CRITICAL';
  if (balance < SURVIVAL_THRESHOLD) return 'AT_RISK';
  return 'ALIVE';
}
export const AGENT_ID = 'agent-survive-01';

export function seedOpportunities(): Opportunity[] {
  let opps = SAMPLE_OPPORTUNITIES.map((o) => ({ ...o }));
  opps = advanceStage(opps, INITIAL_DISCOVERY_IDS, 'DISCOVERED');
  opps = advanceStage(opps, INITIAL_DISCOVERY_IDS, 'RESEARCHED');
  opps = advanceStage(opps, INITIAL_DISCOVERY_IDS, 'VERIFIED');
  opps = scoreAll(opps);
  opps = rankOpportunities(opps);
  return opps.map((o) =>
    INITIAL_DISCOVERY_IDS.includes(o.id)
      ? { ...o, researchStage: 'RANKED' as const, score: scoreOpportunity(o) }
      : o,
  );
}

export interface SeedSnapshot {
  agent: Agent;
  opportunities: Opportunity[];
  transactions: Transaction[];
  events: AgentEvent[];
  strategies: Strategy[];
}

export function createSeedSnapshot(now: number = Date.now()): SeedSnapshot {
  const transactions = openingLedger(STARTING_CAPITAL);
  const opportunities = seedOpportunities();
  const { strategy, objective } = strategyFromMemory([], STARTING_CAPITAL, SURVIVAL_THRESHOLD);

  const events: AgentEvent[] = [
    {
      id: uid('evt'),
      type: 'SYSTEM',
      message:
        'SURVIVE AI agent initialized. Simulated capital $50.00 — no real money, accounts or APIs are connected.',
      createdAt: now - 4000,
    },
    {
      id: uid('evt'),
      type: 'SYSTEM',
      message: `Seeded SAMPLE knowledge base loaded: ${opportunities.length} opportunities (${INITIAL_DISCOVERY_IDS.length} pre-researched). Live web research requires connected search + LLM providers.`,
      createdAt: now - 3000,
    },
    {
      id: uid('evt'),
      type: 'DISCOVERY',
      message: 'Awaiting first research cycle. Trigger a cycle via the dashboard or the Worker cron.',
      createdAt: now - 2000,
    },
  ];

  const strategies: Strategy[] = [
    { id: uid('strat'), name: strategy, rationale: objective, active: true, createdAt: now },
  ];

  const agent: Agent = {
    id: AGENT_ID,
    name: 'SURVIVE-01',
    status: 'ALIVE',
    startedAt: now,
    startingCapital: STARTING_CAPITAL,
    survivalThreshold: SURVIVAL_THRESHOLD,
    currentStrategy: strategy,
    currentObjective: objective,
    cycleCount: 0,
    totalCyclesRun: 0,
  };

  return { agent, opportunities, transactions, events, strategies };
}
