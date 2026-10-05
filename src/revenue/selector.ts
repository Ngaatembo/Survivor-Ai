/* ============================================================================
 * Revenue loop — opportunity scoring and selection (pure, transparent).
 * ----------------------------------------------------------------------------
 *   available  = balance − death threshold − runway reserve   (risk capital)
 *   p          = prior × m                                    (calibrated)
 *   m          = ((wins + K·p̄) / (n + K)) / p̄              K = 5
 *                n = resolved opportunities of this strategy (WON + LOST),
 *                p̄ = their mean prior. With no outcomes yet, m = 1.
 *   score      = value × p ÷ (1 + cost / available)
 *   cost > available → not affordable → not selected
 *
 * So the agent prefers the highest expected value per unit of the $50 put at
 * risk, and its probabilities move toward what real customers actually did.
 * ========================================================================== */

export const CALIBRATION_PSEUDO_COUNT = 5;

export interface StrategyOutcomes {
  wins: number;
  losses: number;
  meanPriorOfResolved: number;
}

export function calibrationMultiplier(o: StrategyOutcomes, k = CALIBRATION_PSEUDO_COUNT): number {
  const n = o.wins + o.losses;
  if (n === 0 || !(o.meanPriorOfResolved > 0)) return 1;
  const pBar = o.meanPriorOfResolved;
  return (o.wins + k * pBar) / (n + k) / pBar;
}

export interface ScoreInput {
  value: number;
  cost: number;
  prior: number;
  multiplier: number;
  available: number;
}

export interface ScoreResult {
  probability: number;
  score: number;
  affordable: boolean;
  explanation: string;
}

const r3 = (x: number) => Math.round(x * 1000) / 1000;

export function scoreOpportunity(i: ScoreInput): ScoreResult {
  const probability = r3(Math.min(0.95, Math.max(0, i.prior * i.multiplier)));
  const available = Math.max(0, i.available);
  const affordable = i.cost <= 0 || i.cost <= available;
  const risk = i.cost <= 0 ? 1 : available > 0 ? 1 + i.cost / available : Infinity;
  const score = affordable ? r3((i.value * probability) / risk) : 0;
  const explanation =
    `score = value $${i.value} × p ${probability} ÷ (1 + cost $${i.cost} / available $${r3(available)}) = ${score}` +
    ` [p = prior ${i.prior} × calibration ${r3(i.multiplier)}]` +
    (affordable ? '' : ' — NOT AFFORDABLE: cost exceeds risk capital above the runway reserve');
  return { probability, score, affordable, explanation };
}

/** Pick the best qualified opportunities up to the free capacity. */
export function selectTop<T extends { score: number }>(qualified: T[], capacity: number): T[] {
  if (capacity <= 0) return [];
  return [...qualified].filter((o) => o.score > 0).sort((a, b) => b.score - a.score).slice(0, capacity);
}
