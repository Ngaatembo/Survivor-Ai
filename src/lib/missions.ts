/* ============================================================================
 * SURVIVE AI — Mission ladder (Survivor 2.0 §10).
 * ----------------------------------------------------------------------------
 * Replaces the freeform Agent.currentObjective string with a structured,
 * ordered sequence of survival milestones the dashboard can show real
 * progress against. Targets scale relative to the agent's actual starting
 * capital rather than the flat $1/$10/$25/$50/$100 figures in the
 * original spec, which assumed a much smaller starting amount than the
 * $50 already running in production — a flat $10 target is meaningless
 * ("already exceeded on cycle 1") once starting capital is $50 or more.
 * Tracks the existing SIMULATED wallet balance (the same number already
 * shown throughout the dashboard as "Simulated Wallet") — never real
 * money, consistent with the rest of the app's simulated economics.
 * ========================================================================== */

import type { Mission } from '../types';
import { uid } from './format';

interface LadderStep {
  sequence: number;
  objective: string;
  targetMultiplier: number; // × startingCapital
  expectedRevenue?: string;
}

const LADDER: LadderStep[] = [
  { sequence: 1, objective: 'Make the first dollar of simulated profit', targetMultiplier: 1, expectedRevenue: '$1-$5' },
  { sequence: 2, objective: 'Grow the simulated wallet by 25%', targetMultiplier: 1.25, expectedRevenue: '$5-$15' },
  { sequence: 3, objective: 'Double the starting simulated capital', targetMultiplier: 2, expectedRevenue: '$15-$40' },
  { sequence: 4, objective: 'Reach 5x the starting simulated capital', targetMultiplier: 5, expectedRevenue: '$40-$100' },
  { sequence: 5, objective: 'Reach 10x the starting simulated capital', targetMultiplier: 10, expectedRevenue: '$100+' },
];

function targetFor(step: LadderStep, startingCapital: number): number {
  if (step.sequence === 1) return Math.round((startingCapital + 1) * 100) / 100;
  return Math.round(startingCapital * step.targetMultiplier * 100) / 100;
}

/** The full mission ladder for a given starting capital. Only the first
 *  mission starts ACTIVE; the rest activate in order as earlier ones
 *  complete (see evaluateMissions/currentMission below). */
export function buildMissionLadder(startingCapital: number, now: number = Date.now()): Mission[] {
  return LADDER.map((step) => ({
    id: uid('mission'),
    sequence: step.sequence,
    objective: step.objective,
    targetBalance: targetFor(step, startingCapital),
    strategy: 'Finding existing demand',
    status: 'ACTIVE' as const,
    expectedRevenue: step.expectedRevenue,
    startedAt: now,
    lessonsLearned: [],
  }));
}

/**
 * Given the current mission list and the current simulated balance,
 * mark any mission whose target has been reached as COMPLETED, with a
 * lesson line recording what strategy was in play. Only the earliest
 * incomplete mission is ever meaningfully "in progress" — see
 * currentMission() for what to actually show on the dashboard.
 */
export function evaluateMissions(missions: Mission[], balance: number, now: number = Date.now()): Mission[] {
  return missions.map((m) => {
    if (m.status !== 'ACTIVE') return m;
    if (balance >= m.targetBalance) {
      return {
        ...m,
        status: 'COMPLETED' as const,
        completedAt: now,
        lessonsLearned: [
          ...m.lessonsLearned,
          `Reached $${balance.toFixed(2)} (target $${m.targetBalance.toFixed(2)}) via the strategy in play at the time: "${m.strategy}".`,
        ],
      };
    }
    return m;
  });
}

/** The mission currently worth showing on the dashboard — the earliest
 *  one not yet completed, or undefined if the whole ladder is done. */
export function currentMission(missions: Mission[]): Mission | undefined {
  return [...missions].sort((a, b) => a.sequence - b.sequence).find((m) => m.status === 'ACTIVE');
}
