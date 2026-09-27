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
import { uid } from '../lib/format';
import { openingLedger } from '../services/wallet';
import { strategyFromMemory } from '../services/ai';

export const STARTING_CAPITAL = 50;
/** Real-treasury ladder (27 Sep 2026). With automatic spending capped at
 *  $0.40/day, the balance only falls slowly, so the warnings start early. */
export const SURVIVAL_THRESHOLD = 25;
/** Below this, the agent is CRITICAL — close to going dormant. */
export const CRITICAL_THRESHOLD = 15;
/** At or below this the agent is DORMANT (stored as the legacy 'DEAD'
 *  status): no paid AI or search, free work only, and it wakes up by itself
 *  when revenue or a top-up lifts the balance back above the floor. Must
 *  match DEFAULT_COST_POLICY.floorUsd in lib/costMeter.ts. */
export const DORMANT_FLOOR = 10;

/** The single source of truth for balance -> survival-status mapping —
 *  previously duplicated three times inline across agentEngine.ts.
 *  'DEAD' means DORMANT: it never stops cycles, it only stops spending. */
export function computeSurvivalStatus(balance: number): 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD' {
  if (balance <= DORMANT_FLOOR) return 'DEAD';
  if (balance < CRITICAL_THRESHOLD) return 'CRITICAL';
  if (balance < SURVIVAL_THRESHOLD) return 'AT_RISK';
  return 'ALIVE';
}
export const AGENT_ID = 'agent-survive-01';

/** Production starts with no opportunities. Live web research creates them. */
export function seedOpportunities() {
  return [];
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
        'SURVIVE AI agent initialized with a real $50.00 operating budget for its own AI and search costs (capped at $0.40/day). All opportunities must come from live research; no sample data is loaded.',
      createdAt: now - 4000,
    },
    {
      id: uid('evt'),
      type: 'SYSTEM',
      message: 'Production data mode: no sample opportunities loaded. Survivor will populate opportunities from live research only.',
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
