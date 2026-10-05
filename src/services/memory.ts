/* ============================================================================
 * SURVIVE AI — Memory service
 * ----------------------------------------------------------------------------
 * Every experiment result is folded into structured memory that influences
 * future decisions: per-opportunity records (tests, spend, revenue,
 * conclusion), per-category rollups, and distilled lessons/assumptions.
 * ========================================================================== */

import type { Experiment, MemoryEntry, MemoryProvenance, Opportunity } from '../types';
import { uid } from '../lib/format';

/**
 * Only memory backed by verified real-world outcomes may influence
 * production decisions. Simulated (Math.random) experiments and everything
 * stored before migration 0022 are history, not experience.
 */
export function realExperience(memory: MemoryEntry[]): MemoryEntry[] {
  return memory.filter((m) => m.provenance === 'REAL_VERIFIED');
}

function provenanceOf(exp: Experiment): MemoryProvenance {
  // Experiments are produced only by the simulator today; a future real
  // experiment must say so explicitly to be treated as experience.
  return exp.simulated === false ? 'REAL_VERIFIED' : 'SIMULATED';
}

function conclude(tests: number, spent: number, revenue: number, lastOutcome: string): MemoryEntry['conclusion'] {
  if (revenue > spent * 1.5 && tests >= 1) return 'VIABLE';
  if (revenue > 0 && revenue >= spent) return 'PROMISING';
  if (tests >= 2 && revenue === 0) return 'AVOID';
  if (tests >= 3 && revenue < spent * 0.5) return 'AVOID';
  if (revenue > 0) return 'MIXED';
  if (lastOutcome === 'INCONCLUSIVE') return 'WATCH';
  return 'UNTESTED';
}

/** Fold an experiment result into opportunity + category memory. */
export function recordResult(
  memory: MemoryEntry[],
  exp: Experiment,
  opp: Opportunity,
): MemoryEntry[] {
  const provenance = provenanceOf(exp);
  // Simulated results never merge into real experience (or vice versa).
  const next = memory.filter((m) => (m.provenance ?? 'SIMULATED_LEGACY') === provenance);

  // --- Per-opportunity memory ---
  let oppMem = next.find((m) => m.kind === 'opportunity' && m.refId === opp.id);
  if (!oppMem) {
    oppMem = {
      id: uid('mem'),
      kind: 'opportunity',
      refId: opp.id,
      title: opp.name,
      tests: 0,
      spent: 0,
      revenue: 0,
      conclusion: 'UNTESTED',
      notes: [],
      updatedAt: Date.now(),
      provenance,
    };
    next.push(oppMem);
  }
  oppMem = {
    ...oppMem,
    tests: oppMem.tests + 1,
    spent: Math.round((oppMem.spent + exp.actualCost) * 100) / 100,
    revenue: Math.round((oppMem.revenue + exp.actualRevenue) * 100) / 100,
    updatedAt: Date.now(),
    notes: [
      `Test ${oppMem.tests + 1}: ${exp.outcome} — cost $${exp.actualCost.toFixed(2)}, revenue $${exp.actualRevenue.toFixed(2)}.`,
      ...exp.lessonsLearned.slice(0, 2).map((l) => `  ↳ ${l}`),
      ...oppMem.notes,
    ].slice(0, 12),
  };
  oppMem.conclusion = conclude(oppMem.tests, oppMem.spent, oppMem.revenue, exp.outcome);
  next.splice(next.findIndex((m) => m.kind === 'opportunity' && m.refId === opp.id), 1, oppMem);

  // --- Per-category rollup ---
  let catMem = next.find((m) => m.kind === 'category' && m.refId === opp.category);
  if (!catMem) {
    catMem = {
      id: uid('mem'),
      kind: 'category',
      refId: opp.category,
      title: opp.category,
      tests: 0,
      spent: 0,
      revenue: 0,
      conclusion: 'UNTESTED',
      notes: [],
      updatedAt: Date.now(),
      provenance,
    };
    next.push(catMem);
  }
  catMem = {
    ...catMem,
    tests: catMem.tests + 1,
    spent: Math.round((catMem.spent + exp.actualCost) * 100) / 100,
    revenue: Math.round((catMem.revenue + exp.actualRevenue) * 100) / 100,
    updatedAt: Date.now(),
    notes: [
      `${opp.name}: ${exp.outcome} (net $${(exp.actualRevenue - exp.actualCost).toFixed(2)}).`,
      ...catMem.notes,
    ].slice(0, 8),
  };
  catMem.conclusion = conclude(catMem.tests, catMem.spent, catMem.revenue, exp.outcome);
  next.splice(next.findIndex((m) => m.kind === 'category' && m.refId === opp.category), 1, catMem);

  return next;
}

/** Distill a global lesson from a completed experiment. */
export function lessonFromExperiment(exp: Experiment): MemoryEntry {
  const net = exp.actualRevenue - exp.actualCost;
  const title =
    exp.outcome === 'SUCCESS'
      ? `Revenue works in "${exp.opportunityName}" — replicate the approach.`
      : exp.outcome === 'PARTIAL_SUCCESS'
        ? `Weak signal in "${exp.opportunityName}" — change one variable and retest.`
        : exp.outcome === 'FAILED'
          ? `"${exp.opportunityName}" produced no return — diagnose before retrying.`
          : `"${exp.opportunityName}" inconclusive — need longer/clearer test.`;
  return {
    id: uid('mem'),
    kind: 'lesson',
    title,
    tests: 1,
    spent: exp.actualCost,
    revenue: exp.actualRevenue,
    conclusion: net > 0 ? 'PROMISING' : net < 0 ? 'WATCH' : 'UNTESTED',
    notes: exp.lessonsLearned,
    updatedAt: Date.now(),
    provenance: provenanceOf(exp),
  };
}
