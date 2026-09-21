/* ============================================================================
 * Survivor AI — Prospect identity/contact verification.
 * ----------------------------------------------------------------------------
 * Discovery can find a plausible business and phone from one search result,
 * but one result is not enough to safely attribute a contact to that business.
 * This layer cross-checks the business name and contact across independent
 * public search results. It never invents a contact and fails closed when
 * evidence conflicts.
 * ========================================================================== */

import type { ContactChannel, Prospect, ProspectVerification, ResearchSource } from '../types';
import type { SearchEconomyContext } from './searchEconomy';
import { runSearch } from './searchEconomy';
import type { SearchResult } from './providers/types';

const GENERIC = new Set([
  'the','and','of','in','for','to','a','an','on','at','by','with','business',
  'services','service','company','ltd','limited','zimbabwe','harare','bulawayo',
  'masvingo','mutare','gweru','shop','store','restaurant','cafe','facebook',
  'instagram','official','home','page','contact',
]);

function normalizeName(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !GENERIC.has(t));
}

function nameSimilarity(a: string, b: string): number {
  const aa = new Set(normalizeName(a));
  const bb = new Set(normalizeName(b));
  if (!aa.size || !bb.size) return 0;
  let common = 0;
  for (const token of aa) if (bb.has(token)) common += 1;
  return common / Math.max(aa.size, bb.size);
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
}

function independentKey(url: string): string {
  const d = domainOf(url);
  if (!d) return '';
  if (d.includes('facebook.com')) return 'facebook.com';
  if (d.includes('instagram.com')) return 'instagram.com';
  if (d.includes('linkedin.com')) return 'linkedin.com';
  if (d.includes('google.com')) return 'google.com';
  return d;
}

function isBusinessResult(prospect: Prospect, result: SearchResult): number {
  const title = result.title || '';
  const text = `${title} ${result.snippet || ''}`.toLowerCase();
  const nameScore = nameSimilarity(prospect.businessName, title) || nameSimilarity(prospect.businessName, text);
  const location = prospect.location.toLowerCase().trim();
  const locationSignal = location && text.includes(location) ? 0.12 : 0;
  const domain = domainOf(result.url);
  const nameDomainSignal = normalizeName(prospect.businessName).some((t) => domain.includes(t)) ? 0.12 : 0;
  return Math.min(1, nameScore + locationSignal + nameDomainSignal);
}

function cleanName(title: string): string {
  return title
    .split(/[|·]| - Facebook| - Instagram| on Instagram| \(@[^)]*\)/i)[0]
    .replace(/\s*\|\s*Facebook.*$/i, '')
    .replace(/\s*-\s*Home$/i, '')
    .trim()
    .slice(0, 100);
}

function extractPhones(text: string): string[] {
  const matches = text.match(/\+?\d[\d\s()\-]{6,}\d/g) ?? [];
  const out: string[] = [];
  for (const raw of matches) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 7 && digits.length <= 13 && !out.includes(raw.trim())) out.push(raw.trim());
  }
  return out;
}

function normalizePhone(value?: string): string {
  return (value ?? '').replace(/\D/g, '').replace(/^0/, '263');
}

function sourceFor(result: SearchResult, note: string): ResearchSource {
  return {
    id: `verify-${Math.random().toString(36).slice(2, 10)}`,
    title: result.title.slice(0, 140),
    url: result.url,
    kind: 'web',
    note,
  };
}

function chooseCanonicalName(prospect: Prospect, results: SearchResult[]): { name?: string; score: number } {
  const candidates = results
    .map((r) => ({ name: cleanName(r.title), score: isBusinessResult(prospect, r) }))
    .filter((x) => x.name.length >= 3 && x.score >= 0.62)
    .sort((a,b) => b.score - a.score);
  return candidates[0] ? { name: candidates[0].name, score: candidates[0].score } : { score: 0 };
}

export async function verifyProspect(
  ctx: SearchEconomyContext,
  prospect: Prospect,
  now = Date.now(),
): Promise<Prospect> {
  const queries = [
    `"${prospect.businessName}" "${prospect.location}" phone WhatsApp contact`,
    `"${prospect.businessName}" "${prospect.location}" official website Facebook Instagram`,
  ];

  const results: SearchResult[] = [];
  const seen = new Set<string>();
  for (const query of queries) {
    const outcome = await runSearch(ctx, {
      purpose: 'CONTACT_VERIFICATION',
      query,
      entityId: prospect.id,
      max: 5,
      priority: prospect.priority,
    });
    for (const r of outcome.results) {
      const key = `${r.url}|${r.title}`;
      if (!seen.has(key)) { seen.add(key); results.push(r); }
    }
  }

  if (results.length === 0) {
    return {
      ...prospect,
      verification: prospect.verification ?? {
        status: 'UNVERIFIED',
        confidence: 0,
        businessNameMatchScore: 0,
        contactMatchScore: 0,
        independentSources: 0,
        contactSources: 0,
        sourceUrls: [],
        conflictingContacts: [],
        notes: ['No independent verification results available; do not treat the stored contact as verified.'],
        verifiedAt: now,
      },
      updatedAt: now,
    };
  }

  const identityResults = results
    .map((r) => ({ r, score: isBusinessResult(prospect, r) }))
    .filter((x) => x.score >= 0.55)
    .sort((a,b) => b.score - a.score);

  const sourceKeys = new Set(identityResults.map((x) => independentKey(x.r.url)).filter(Boolean));
  const canonical = chooseCanonicalName(prospect, results);

  const contacts = new Map<string, { raw: string; keys: Set<string>; bestScore: number }>();
  for (const { r, score } of identityResults) {
    const key = independentKey(r.url);
    if (!key) continue;
    for (const raw of extractPhones(`${r.title} ${r.snippet}`)) {
      const normalized = normalizePhone(raw);
      const current = contacts.get(normalized) ?? { raw, keys: new Set<string>(), bestScore: 0 };
      current.keys.add(key);
      current.bestScore = Math.max(current.bestScore, score);
      contacts.set(normalized, current);
    }
  }

  const rankedContacts = [...contacts.entries()]
    .map(([normalized, v]) => ({ normalized, ...v, sources: v.keys.size }))
    .sort((a,b) => b.sources - a.sources || b.bestScore - a.bestScore);

  const existingNormalized = normalizePhone(prospect.contactValue);
  const bestContact = rankedContacts[0];
  const conflicts = rankedContacts
    .filter((c) => c.sources >= 1)
    .map((c) => c.raw)
    .filter((v, i, arr) => arr.indexOf(v) === i);

  const verifiedContact = bestContact && (
    bestContact.sources >= 2 ||
    (bestContact.sources >= 1 && bestContact.bestScore >= 0.82)
  );

  const identityScore = canonical.score;
  const contactScore = bestContact
    ? Math.min(1, bestContact.bestScore + Math.min(0.25, (bestContact.sources - 1) * 0.2))
    : 0;

  const contactConflict = rankedContacts.length > 1 &&
    rankedContacts[0].normalized !== rankedContacts[1].normalized &&
    rankedContacts[0].sources === rankedContacts[1].sources &&
    rankedContacts[0].sources >= 1;

  const status: ProspectVerification['status'] =
    contactConflict ? 'CONFLICT' :
    (identityScore >= 0.72 && sourceKeys.size >= 2 && verifiedContact) ? 'VERIFIED' :
    (identityScore >= 0.55 && (sourceKeys.size >= 1 || existingNormalized)) ? 'PROVISIONAL' :
    'UNVERIFIED';

  const verifiedValue = status === 'VERIFIED' || status === 'PROVISIONAL'
    ? (bestContact?.raw ?? (existingNormalized ? prospect.contactValue : undefined))
    : undefined;

  const verifiedChannel: ContactChannel | undefined = verifiedValue
    ? 'PHONE'
    : undefined;

  const notes: string[] = [];
  if (sourceKeys.size >= 2) notes.push(`${sourceKeys.size} independent public source domains support the business identity.`);
  else if (sourceKeys.size === 1) notes.push('Only one independent source domain matched the business; identity remains provisional.');
  if (bestContact?.sources >= 2) notes.push('The same phone number appears on multiple independent public sources.');
  else if (bestContact) notes.push('A phone number was found on a matching source, but it is not corroborated across multiple domains.');
  if (rankedContacts.length > 1) notes.push(`Multiple contact numbers were found: ${rankedContacts.map((c) => c.raw).join(', ')}. Keep the conflict visible for human review.`);
  if (canonical.name && nameSimilarity(prospect.businessName, canonical.name) < 1) notes.push(`Canonical source name differs from the discovery label: "${canonical.name}".`);

  const verification: ProspectVerification = {
    status,
    confidence: Math.round(((identityScore * 0.55) + (contactScore * 0.45)) * 100),
    verifiedBusinessName: canonical.name && identityScore >= 0.72 ? canonical.name : undefined,
    verifiedContactChannel: verifiedChannel,
    verifiedContactValue: verifiedValue,
    businessNameMatchScore: Number(identityScore.toFixed(3)),
    contactMatchScore: Number(contactScore.toFixed(3)),
    independentSources: sourceKeys.size,
    contactSources: bestContact?.sources ?? 0,
    sourceUrls: identityResults.slice(0, 8).map((x) => x.r.url).filter(Boolean),
    conflictingContacts: conflicts.length > 1 ? conflicts : [],
    notes,
    verifiedAt: now,
  };

  const next: Prospect = {
    ...prospect,
    businessName: verification.verifiedBusinessName ?? prospect.businessName,
    contactChannel: verification.verifiedContactChannel ?? (status === 'CONFLICT' ? 'UNKNOWN' : prospect.contactChannel),
    contactValue: verification.verifiedContactValue,
    verification,
    evidenceNotes: `${prospect.evidenceNotes} Verification: ${verification.notes.join(' ')}`.trim(),
    updatedAt: now,
  };

  // A conflicting contact is deliberately not carried into the CRM contact
  // field. The evidence remains in verification.conflictingContacts for a
  // human to inspect; outreach must never use an ambiguous number.
  if (status === 'CONFLICT') {
    next.contactValue = undefined;
    next.contactChannel = 'UNKNOWN';
  }

  return next;
}
