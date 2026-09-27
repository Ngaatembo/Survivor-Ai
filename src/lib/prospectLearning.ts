import type { Prospect, ProspectIntelligence, ProspectProblemType } from '../types';

export interface ProblemOutcomeStats { type: ProspectProblemType; decided: number; won: number; lost: number; closeRate?: number; }

export function computeProblemOutcomeStats(prospects: Prospect[], intelligence: ProspectIntelligence[]): ProblemOutcomeStats[] {
  const byType = new Map<ProspectProblemType, { decided: number; won: number; lost: number }>();
  const intelByProspect = new Map(intelligence.map((i) => [i.prospectId, i]));
  for (const prospect of prospects) {
    if (prospect.status !== 'WON' && prospect.status !== 'LOST' && prospect.status !== 'NOT_INTERESTED') continue;
    const type = intelByProspect.get(prospect.id)?.primaryProblem?.type;
    if (!type) continue;
    const row = byType.get(type) ?? { decided: 0, won: 0, lost: 0 };
    row.decided += 1;
    if (prospect.status === 'WON') row.won += 1; else row.lost += 1;
    byType.set(type, row);
  }
  return [...byType.entries()].map(([type, row]) => ({ type, ...row, closeRate: row.decided ? row.won / row.decided : undefined }));
}

export function problemLearningAdjustment(type: ProspectProblemType, stats: ProblemOutcomeStats[]): { bonus: number; reason?: string } {
  const row = stats.find((s) => s.type === type);
  if (!row || row.decided < 3 || row.closeRate === undefined) return { bonus: 0 };
  if (row.closeRate >= 0.6) return { bonus: 8, reason: type + ' has ' + Math.round(row.closeRate * 100) + '% observed close rate across ' + row.decided + ' decided prospects.' };
  if (row.closeRate <= 0.2) return { bonus: -8, reason: type + ' has ' + Math.round(row.closeRate * 100) + '% observed close rate across ' + row.decided + ' decided prospects.' };
  return { bonus: 0, reason: type + ' has ' + Math.round(row.closeRate * 100) + '% observed close rate across ' + row.decided + ' decided prospects.' };
}