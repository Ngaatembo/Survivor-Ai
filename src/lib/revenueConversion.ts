import type { Prospect } from '../types';

export interface RevenueConversionCandidate {
  prospect: Prospect;
  score: number;
  reasons: string[];
}

const PRIORITY_WEIGHT: Record<Prospect['priority'], number> = {
  HIGH: 15,
  MEDIUM: 10,
  LOW: 4,
  DO_NOT_CONTACT: -100,
};

const CONTACT_WEIGHT: Record<Prospect['contactChannel'], number> = {
  WHATSAPP: 14,
  PHONE: 13,
  EMAIL: 12,
  FACEBOOK: 10,
  INSTAGRAM: 10,
  WEBSITE_FORM: 7,
  UNKNOWN: 0,
};

const WEBSITE_SIGNAL: Record<Prospect['websitePresence'], number> = {
  NONE_FOUND: 8,
  SOCIAL_ONLY: 7,
  WEAK_OR_OUTDATED: 8,
  ADEQUATE: 3,
  UNKNOWN: 1,
};

/**
 * Rank prospects for human revenue work.
 *
 * This is deliberately a second-stage sales ranking, not a replacement for
 * the explainable lead score. It asks: "Who is worth preparing a complete
 * sales package for now?" It rewards expected value, a clear contact route,
 * evidence quality, and the website/service gap without inventing facts.
 */
export function rankRevenueProspects(
  prospects: Prospect[],
  limit = 5,
): RevenueConversionCandidate[] {
  const candidates = prospects
    .filter((p) =>
      (p.status === 'DISCOVERED' || p.status === 'QUALIFIED') &&
      p.priority !== 'DO_NOT_CONTACT' &&
      Boolean(p.businessName.trim()),
    )
    .map((prospect) => {
      const lead = Math.max(0, Math.min(100, prospect.score.total));
      const ev = Math.max(0, prospect.score.expectedValue);
      const evSignal = Math.min(25, Math.log10(1 + ev) * 10);
      const contact = CONTACT_WEIGHT[prospect.contactChannel] + (prospect.contactValue ? 4 : 0);
      const evidence = Math.min(12, prospect.sources.length * 2) + (prospect.evidenceNotes.trim().length >= 80 ? 3 : 0);
      const webGap = WEBSITE_SIGNAL[prospect.websitePresence];
      const recencyDays = Math.max(0, (Date.now() - prospect.dateDiscovered) / 86_400_000);
      const recency = recencyDays <= 3 ? 5 : recencyDays <= 14 ? 3 : 1;
      const priority = PRIORITY_WEIGHT[prospect.priority];

      const score = lead * 0.5 + evSignal + priority + contact * 0.65 + evidence * 0.7 + webGap * 0.6 + recency;
      const reasons: string[] = [];
      if (prospect.score.total >= 70) reasons.push(`lead score ${prospect.score.total}/100`);
      else if (prospect.score.total >= 60) reasons.push(`lead score ${prospect.score.total}/100`);
      if (prospect.score.expectedValue > 0) reasons.push(`expected value $${prospect.score.expectedValue.toFixed(0)}`);
      if (prospect.contactValue) reasons.push(`contact route: ${prospect.contactChannel.toLowerCase()}`);
      if (prospect.sources.length > 0) reasons.push(`${prospect.sources.length} source(s)`);
      if (prospect.websitePresence === 'NONE_FOUND' || prospect.websitePresence === 'WEAK_OR_OUTDATED' || prospect.websitePresence === 'SOCIAL_ONLY') {
        reasons.push('clearer digital-service gap signal');
      }
      return { prospect, score, reasons: reasons.slice(0, 4) };
    })
    .sort((a, b) => b.score - a.score || b.prospect.score.expectedValue - a.prospect.score.expectedValue || b.prospect.score.total - a.prospect.score.total);

  // Avoid presenting the same business repeatedly when discovery has produced
  // duplicate records. Keep the highest-ranked record for each normalized name.
  const seen = new Set<string>();
  const unique: RevenueConversionCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.prospect.businessName.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
    if (unique.length >= limit) break;
  }
  return unique;
}
