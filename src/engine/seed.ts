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
import { strategyFromMemory } from '../services/ai';

export const STARTING_CAPITAL = 50;
/** First experiment: the run dies when its balance reaches $0. */
export const DEATH_THRESHOLD = 0;
/** Below this the run is DEPLETED (still alive, close to death). */
export const DEPLETED_THRESHOLD = 5;
/** Strategy text switches to DEFENSIVE below half the starting capital. */
export const SURVIVAL_THRESHOLD = 25;

export interface RunTerms {
  status?: string;
  startingCapital: number;
  deathThreshold: number;
  depletedThreshold: number;
}

/**
 * Balance → dashboard/search-budget status band. DEAD means the run reached
 * its death threshold (or is recorded DEAD) and is final; there is no
 * "dormant" state that wakes up on a top-up any more.
 */
export function computeSurvivalStatus(balance: number, run?: RunTerms | null): 'ALIVE' | 'AT_RISK' | 'CRITICAL' | 'DEAD' {
  const starting = run?.startingCapital ?? STARTING_CAPITAL;
  const death = run?.deathThreshold ?? DEATH_THRESHOLD;
  const depleted = run?.depletedThreshold ?? DEPLETED_THRESHOLD;
  if (run?.status === 'DEAD' || balance <= death) return 'DEAD';
  if (balance <= depleted) return 'CRITICAL';
  if (balance < starting * 0.5) return 'AT_RISK';
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
  // No capital is created here. Money enters only as a run's starting
  // capital through Treasury.createRun (an explicit operator action).
  const transactions: Transaction[] = [];
  const opportunities = seedOpportunities();
  const { strategy, objective } = strategyFromMemory([], STARTING_CAPITAL, SURVIVAL_THRESHOLD);

  const events: AgentEvent[] = [
    {
      id: uid('evt'),
      type: 'SYSTEM',
      message:
        'SURVIVE AI agent initialized. It holds no money until an operator creates a Survivor run with explicit starting capital; AI and search costs are then paid from that run, and the run ends permanently at its death threshold.',
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
