/* ============================================================================
 * SURVIVE AI — First Dollar Challenge
 * ----------------------------------------------------------------------------
 * The first-dollar milestone is deliberately based on the real-revenue ledger,
 * not the simulated wallet. An entry only reaches this milestone after the
 * authenticated operator records an actual transaction. This keeps simulated
 * experiments and real-world cash evidence separate.
 * ========================================================================== */

import type { RealRevenueEntry } from '../types';

export const FIRST_DOLLAR_TARGET = 1;

export interface FirstDollarChallenge {
  target: number;
  recordedRevenue: number;
  remaining: number;
  reached: boolean;
  entryCount: number;
  firstEntryId?: string;
  firstEntryAmount?: number;
}

export function evaluateFirstDollarChallenge(
  entries: RealRevenueEntry[],
  target: number = FIRST_DOLLAR_TARGET,
): FirstDollarChallenge {
  const valid = entries.filter(
    (entry) =>
      Number.isFinite(entry.amountReceived) &&
      entry.amountReceived > 0 &&
      typeof entry.id === 'string' &&
      entry.id.length > 0,
  );
  const recordedRevenue = Math.round(valid.reduce((sum, entry) => sum + entry.amountReceived, 0) * 100) / 100;
  const safeTarget = Math.max(0, Number.isFinite(target) ? target : FIRST_DOLLAR_TARGET);
  const first = [...valid].sort((a, b) => a.date - b.date || a.createdAt - b.createdAt)[0];

  return {
    target: safeTarget,
    recordedRevenue,
    remaining: Math.max(0, Math.round((safeTarget - recordedRevenue) * 100) / 100),
    reached: recordedRevenue >= safeTarget,
    entryCount: valid.length,
    firstEntryId: first?.id,
    firstEntryAmount: first?.amountReceived,
  };
}
