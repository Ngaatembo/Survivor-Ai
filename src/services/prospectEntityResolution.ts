/* ============================================================================
 * Survivor AI — prospect entity resolution.
 * ----------------------------------------------------------------------------
 * Discovery can surface the same real business from several searches with
 * slightly different labels. This module resolves ONLY high-confidence
 * duplicates before persistence; it never guesses that two similarly named
 * businesses are the same when location/contact evidence is insufficient.
 * ========================================================================== */

import type { Prospect } from '../types';

const GENERIC = new Set([
  'the','and','of','in','for','to','a','an','on','at','by','with',
  'business','services','service','company','co','ltd','limited',
  'zimbabwe','harare','bulawayo','masvingo','mutare','gweru',
  'shop','store','restaurant','cafe','official','home','page','contact',
]);

function tokens(value: string): Set<string> {
  return new Set(
    value.toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((t) => t.length >= 2 && !GENERIC.has(t)),
  );
}

function similarity(a: string, b: string): number {
  const aa = tokens(a);
  const bb = tokens(b);
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

function normalizePhone(value?: string): string {
  return (value ?? '').replace(/\D/g, '').replace(/^0/, '263');
}

function sameLocation(a: Prospect, b: Prospect): boolean {
  const aa = a.location.toLowerCase().trim();
  const bb = b.location.toLowerCase().trim();
  return Boolean(aa && bb && (aa === bb || aa.includes(bb) || bb.includes(aa)));
}

function sameContact(a: Prospect, b: Prospect): boolean {
  const aa = normalizePhone(a.contactValue);
  const bb = normalizePhone(b.contactValue);
  return Boolean(aa && bb && aa.length >= 7 && aa === bb);
}

/** A conservative identity decision. */
export function sameBusiness(a: Prospect, b: Prospect): boolean {
  if (sameContact(a, b)) return true;

  const nameScore = similarity(a.businessName, b.businessName);
  if (nameScore >= 0.9 && sameLocation(a, b)) return true;

  // A very strong name match can still resolve when one record has no useful
  // location. We deliberately require >= 0.97 so similarly named businesses
  // do not collapse across cities accidentally.
  return nameScore >= 0.97 && (!a.location || !b.location);
}

function mergeSources(a: Prospect, b: Prospect) {
  const out = [...a.sources];
  for (const source of b.sources) {
    if (!out.some((existing) => existing.url && source.url && existing.url === source.url)) {
      out.push(source);
    }
  }
  return out.slice(0, 20);
}

/**
 * Merge a newly discovered batch into the existing set only where identity
 * evidence is strong. The returned accepted list is safe to persist as
 * new/updated records; merged reports how many candidates were folded into
 * an existing entity.
 */
export function resolveProspectEntities(
  existing: Prospect[],
  discovered: Prospect[],
): { accepted: Prospect[]; merged: number } {
  const working = [...existing];
  const accepted: Prospect[] = [];
  let merged = 0;

  for (const candidate of discovered) {
    const match = working.find((current) => sameBusiness(current, candidate));

    if (!match) {
      working.push(candidate);
      accepted.push(candidate);
      continue;
    }

    merged += 1;

    // Prefer the record with stronger verification/evidence. Never overwrite
    // a verified contact with an unverified discovery value.
    const currentVerification = match.verification;
    const candidateVerification = candidate.verification;
    const candidateIsStronger =
      (candidateVerification?.confidence ?? 0) > (currentVerification?.confidence ?? 0);

    const mergedProspect: Prospect = {
      ...match,
      businessName: candidateIsStronger ? candidate.businessName : match.businessName,
      location: candidateIsStronger ? candidate.location : match.location,
      websiteUrl: candidate.websiteUrl ?? match.websiteUrl,
      websitePresence:
        match.websitePresence === 'UNKNOWN' ? candidate.websitePresence : match.websitePresence,
      socialLinks: [...new Set([...match.socialLinks, ...candidate.socialLinks])].slice(0, 10),
      contactChannel:
        currentVerification?.status === 'VERIFIED'
          ? match.contactChannel
          : (candidate.contactChannel !== 'UNKNOWN' ? candidate.contactChannel : match.contactChannel),
      contactValue:
        currentVerification?.status === 'VERIFIED'
          ? match.contactValue
          : (candidate.contactValue ?? match.contactValue),
      sources: mergeSources(match, candidate),
      evidenceNotes: [match.evidenceNotes, candidate.evidenceNotes].filter(Boolean).join(' '),
      updatedAt: Math.max(match.updatedAt, candidate.updatedAt),
    };

    const index = accepted.findIndex((p) => p.id === match.id);
    if (index >= 0) accepted[index] = mergedProspect;
    else accepted.push(mergedProspect);
  }

  return { accepted, merged };
}
