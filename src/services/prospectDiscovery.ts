/* ============================================================================
 * Local business prospect discovery (build-spec §7/§8).
 * ----------------------------------------------------------------------------
 * Dedicated workflow for the strongest current practical route to real
 * revenue: local businesses that may need a website. Uses the same
 * SearchProvider as opportunity discovery — real web search results only.
 *
 * Every prospect record traces back to at least one cited, real search
 * result. Website status defaults to UNKNOWN and is only marked
 * SOCIAL_ONLY / WEAK_OR_OUTDATED / ADEQUATE when the cited source text
 * actually supports that conclusion — never fabricated (spec §7: "Never
 * claim that a business has no website unless the available evidence
 * supports that conclusion").
 *
 * Fails soft: if the search provider errors or returns nothing, this
 * returns an empty list — callers must never fall back to fake prospects.
 * ========================================================================== */

import type { BusinessModel, ContactChannel, Opportunity, Prospect, ResearchSource, WebsitePresence } from '../types';
import { uid } from '../lib/format';
import { scoreProspect, priorityFromScore } from '../lib/prospectScoring';
import type { CategoryRealWorldStats } from '../lib/realRevenue';
import { runSearch, type SearchEconomyContext } from './searchEconomy';

/** Rotated across cycles (by day) rather than all searched every cycle, to
 *  keep the query budget bounded alongside opportunity discovery's own
 *  searches in the same cycle. */
const CATEGORY_SEEDS: { label: string; terms: string }[] = [
  { label: 'Local service business (plumbing/electrical)', terms: 'plumber OR electrician' },
  { label: 'Local retail / boutique', terms: 'boutique clothing shop OR retail store' },
  { label: 'Local food & hospitality', terms: 'restaurant OR bakery OR cafe' },
  { label: 'Local trades & auto', terms: 'auto repair garage OR construction contractor' },
  { label: 'Local personal services', terms: 'hair salon OR tutoring service OR photographer' },
];

const MAX_QUERIES_PER_CYCLE = 3;
const MAX_RESULTS_PER_QUERY = 5;
const MAX_NEW_PROSPECTS_PER_CYCLE = 8;

// Phone separators are spaces, hyphens, or parens — deliberately excludes
// '.' as a separator: a period followed by digits reads as a decimal
// fraction (e.g. an exchange-rate figure like "16.0001" in an economics
// article), not a phone number, and an earlier version of this regex
// matched exactly that kind of unrelated figure as if it were a contact
// number. A real phone number match is also validated for a plausible
// digit count below, since even a tightened pattern can span unrelated
// text if the separators happen to line up.
const PHONE_RE = /(\+?\d[\d\s()-]{6,}\d)/;
const MIN_PHONE_DIGITS = 7;
const MAX_PHONE_DIGITS = 13;

function looksLikeRealPhoneNumber(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, '');
  return digits.length >= MIN_PHONE_DIGITS && digits.length <= MAX_PHONE_DIGITS;
}
const COMMERCIAL_HINTS = ['open', 'hours', 'call us', 'order', 'book now', 'service', 'contact us', 'located', 'price', 'quote'];
const URGENCY_HINTS = ['now open', 'new location', 'hiring', 'grand opening', 'coming soon', 'newly opened'];

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

function cleanBusinessName(title: string): string {
  return title
    .split(/[|·]| - Facebook| - Instagram| on Instagram| \(@[^)]*\)/i)[0]
    .replace(/\s*\|\s*Facebook.*$/i, '')
    .replace(/\s*-\s*Home$/i, '')
    .trim()
    .slice(0, 80);
}

function classifyPresence(domain: string, snippet: string): { presence: WebsitePresence; note: string } {
  const s = snippet.toLowerCase();
  if (domain.includes('facebook.com')) {
    return { presence: 'SOCIAL_ONLY', note: 'Primary public result is a Facebook page, not an independent website.' };
  }
  if (domain.includes('instagram.com')) {
    return { presence: 'SOCIAL_ONLY', note: 'Primary public result is an Instagram profile, not an independent website.' };
  }
  const isDirectory = /(yellowpages|brabys|finder\.|listings?\.|directory)/.test(domain);
  if (isDirectory) {
    return { presence: 'UNKNOWN', note: `Found via a business directory listing (${domain}) — own-website status not determinable from this source.` };
  }
  if (/(under construction|coming soon|outdated|last updated \d{4})/.test(s)) {
    return { presence: 'WEAK_OR_OUTDATED', note: 'Source text suggests the existing website is outdated or unfinished.' };
  }
  if (domain) {
    return { presence: 'ADEQUATE', note: `Indexed under its own domain (${domain}) — appears to already have a website; quality not independently verified.` };
  }
  return { presence: 'UNKNOWN', note: 'Website status not determinable from available sources.' };
}

function classifyContact(domain: string, url: string, text: string): { channel: ContactChannel; value?: string } {
  const phoneMatch = text.match(PHONE_RE);
  if (phoneMatch && looksLikeRealPhoneNumber(phoneMatch[1])) {
    return { channel: 'PHONE', value: phoneMatch[1].trim() };
  }
  if (domain.includes('wa.me') || /whatsapp/i.test(text)) return { channel: 'WHATSAPP', value: url };
  if (domain.includes('facebook.com')) return { channel: 'FACEBOOK', value: url };
  if (domain.includes('instagram.com')) return { channel: 'INSTAGRAM', value: url };
  if (domain) return { channel: 'WEBSITE_FORM', value: url };
  return { channel: 'UNKNOWN' };
}

function rotatedSeeds(now: number): typeof CATEGORY_SEEDS {
  const dayIndex = Math.floor(now / 86_400_000);
  const offset = dayIndex % CATEGORY_SEEDS.length;
  return [...CATEGORY_SEEDS.slice(offset), ...CATEGORY_SEEDS.slice(0, offset)].slice(0, MAX_QUERIES_PER_CYCLE);
}

export async function discoverProspects(
  ctx: SearchEconomyContext,
  opportunity: Opportunity,
  businessModel: BusinessModel | undefined,
  existingBusinessNames: string[],
  categoryStats?: CategoryRealWorldStats,
  now: number = Date.now(),
): Promise<{ prospects: Prospect[]; queriesRun: number; sourcesCount: number; cacheHits: number; budgetExceeded: number }> {
  const region = opportunity.geographicRelevance[0] ?? 'Zimbabwe';
  const seeds = rotatedSeeds(now);
  const found: Prospect[] = [];
  let queriesRun = 0;
  let sourcesCount = 0;
  let cacheHits = 0;
  let budgetExceeded = 0;

  for (const seed of seeds) {
    if (found.length >= MAX_NEW_PROSPECTS_PER_CYCLE) break;
    // entityId scopes the cache/budget per (opportunity, seed) pair — the
    // same local-business seed for the same opportunity is not re-searched
    // within its TTL, but different opportunities/seeds are tracked
    // independently.
    const entityId = `${opportunity.id}::${seed.label}`;
    const searchOutcome = await runSearch(ctx, {
      purpose: 'PROSPECT_DISCOVERY',
      query: `${seed.terms} small business in ${region} contact`,
      entityId,
      max: MAX_RESULTS_PER_QUERY,
    });
    if (searchOutcome.budgetExceeded) {
      budgetExceeded += 1;
      continue;
    }
    if (searchOutcome.cacheHit) cacheHits += 1;
    const results = searchOutcome.results;
    queriesRun += 1;
    if (results.length === 0) continue;

    for (const r of results) {
      if (found.length >= MAX_NEW_PROSPECTS_PER_CYCLE) break;
      sourcesCount += 1;

      // A Facebook GROUP is a community, not a business — Facebook renders
      // its post-page titles as "{Group Name} | {Post text}", which would
      // otherwise get misparsed as a business name below, with the post's
      // content (and any contact info in it) wrongly attributed to it —
      // that content belongs to whichever member posted it, not to the
      // group. Never a reliable prospect source; skip entirely.
      if (/facebook\.com\/groups\//i.test(r.url)) continue;

      const businessName = cleanBusinessName(r.title);
      if (!businessName || businessName.length < 3) continue;
      if (existingBusinessNames.some((n) => n.toLowerCase() === businessName.toLowerCase())) continue;
      if (found.some((p) => p.businessName.toLowerCase() === businessName.toLowerCase())) continue;

      const domain = extractDomain(r.url);
      const text = `${r.title} ${r.snippet}`;
      const { presence, note } = classifyPresence(domain, r.snippet);
      const { channel, value } = classifyContact(domain, r.url, text);
      const hasCommercialSignals = COMMERCIAL_HINTS.some((h) => text.toLowerCase().includes(h));
      const hasUrgencySignal = URGENCY_HINTS.some((h) => text.toLowerCase().includes(h));

      // Require some real evidence this is an actual business, not a news
      // article, policy post, or other content that merely mentions a
      // category keyword — either the text itself signals commercial
      // activity (hours, pricing, "call us", etc.) or it's indexed under
      // its own domain (a reasonable proxy for being a real business with
      // a real web presence). Without either, this is far more likely to
      // be irrelevant content than a prospect — e.g. a shared news
      // article about a government policy change was previously scored
      // 74/100 and marked HIGH priority despite not being a business at
      // all. Skip rather than create a low-confidence prospect from it.
      if (!hasCommercialSignals && presence !== 'ADEQUATE') continue;

      const sources: ResearchSource[] = [
        {
          id: uid('src'),
          title: r.title.slice(0, 140),
          url: r.url,
          kind: 'web',
          note: `Found via live search (${seed.label}) — ${searchOutcome.providerUsed}${r.publishedAt ? ` · ${r.publishedAt}` : ''}`,
        },
      ];

      const score = scoreProspect(
        {
          websitePresence: presence,
          contactChannel: channel,
          sourcesCount: 1,
          hasCommercialSignals,
          hasUrgencySignal,
        },
        businessModel,
        categoryStats,
        now,
      );
      const priority = priorityFromScore(score, presence);

      const prospect: Prospect = {
        id: uid('prospect'),
        opportunityId: opportunity.id,
        opportunityName: opportunity.name,
        businessName,
        category: seed.label,
        location: region,
        websitePresence: presence,
        websiteUrl: presence === 'ADEQUATE' ? r.url : undefined,
        socialLinks: channel === 'FACEBOOK' || channel === 'INSTAGRAM' ? [r.url] : [],
        contactChannel: channel,
        contactValue: value,
        sources,
        evidenceNotes: `${note} ${hasCommercialSignals ? 'Source text shows signs of active operation.' : 'No explicit activity signal in the cited snippet — treat as preliminary.'}`,
        priority,
        score,
        status: priority === 'HIGH' || priority === 'MEDIUM' ? 'QUALIFIED' : 'DISCOVERED',
        dataSource: 'LIVE',
        dateDiscovered: now,
        messagesSentCount: 0,
        responsesReceivedCount: 0,
        actualRevenue: 0,
        notes: [],
        createdAt: now,
        updatedAt: now,
      };
      found.push(prospect);
    }
  }

  return { prospects: found, queriesRun, sourcesCount, cacheHits, budgetExceeded };
}
