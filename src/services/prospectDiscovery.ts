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
import { extractDomain, judgeSearchResult, isSocialDomain, isWhatsAppDomain } from '../lib/prospectResultFilter';

/* ----------------------------------------------------------------------------
 * What to search for, and where.
 * ----------------------------------------------------------------------------
 * Root cause this replaces (live D1, 27 Sept 2026): five seeds rotated once a
 * DAY and always searched "in Zimbabwe", with a 48h cache — so every cycle
 * after the first re-read the same cached results and found nothing new
 * (16 real prospect searches in two weeks, 2 prospects). Now every fresh
 * search moves to the next (business type × town) pair, so each one looks at
 * a different slice of the market. Labels keep the words zimWebsitePricing's
 * tier detection keys on (salon, restaurant, lodge, car hire, …).
 * -------------------------------------------------------------------------- */
export const CATEGORY_SEEDS: { label: string; terms: string }[] = [
  { label: 'Auto repair & panel beaters', terms: 'panel beaters OR auto repair garage OR mechanic workshop' },
  { label: 'Hair salons & barbers', terms: 'hair salon OR barber shop OR beauty salon' },
  { label: 'Restaurants & takeaways (food)', terms: 'restaurant OR takeaway OR fast food' },
  { label: 'Plumbing, electrical & solar', terms: 'plumber OR electrician OR solar installation company' },
  { label: 'Lodges & guest houses', terms: 'lodge OR guest house OR B&B accommodation' },
  { label: 'Construction & builders', terms: 'construction company OR builders OR building contractor' },
  { label: 'Clothing boutiques & tailors', terms: 'boutique OR clothing shop OR tailor' },
  { label: 'Car hire & tours', terms: 'car hire OR car rental OR shuttle and tours' },
  { label: 'Bakeries & catering (food)', terms: 'bakery OR cakes OR catering services' },
  { label: 'Hardware & building supplies', terms: 'hardware store OR building materials supplier' },
  { label: 'Schools, colleges & tutors', terms: 'driving school OR private college OR tutoring centre' },
  { label: 'Events, venues & photography', terms: 'events venue OR photographer OR decor hire' },
  { label: 'Furniture & carpentry', terms: 'furniture shop OR carpentry OR kitchen units' },
  { label: 'Printing, signage & branding', terms: 'printing and branding OR signage company' },
  { label: 'Clinics, pharmacies & gyms', terms: 'pharmacy OR dental clinic OR gym' },
];

/** Towns, nearest to WebAura (Marondera) first. An odd count, so the
 *  Facebook-only / open-web alternation below never locks to one town. */
export const TARGET_TOWNS = [
  'Marondera', 'Harare', 'Ruwa', 'Chitungwiza', 'Mutare', 'Bulawayo', 'Gweru',
  'Kwekwe', 'Masvingo', 'Kadoma', 'Norton', 'Bindura', 'Rusape',
];

/** Entity-id prefix for automatic (rotating) discovery searches — also how
 *  the rotation cursor is recovered from the search log. */
const AUTO_ENTITY_PREFIX = 'auto-prospect::';

/** The k-th search in the rotation: towns change every search, business
 *  type changes after each full round of towns; 2 of every 3 searches are
 *  restricted to Facebook pages (the businesses most likely to need a site). */
export function rotationPair(k: number): { seed: (typeof CATEGORY_SEEDS)[number]; town: string; facebookOnly: boolean } {
  const town = TARGET_TOWNS[k % TARGET_TOWNS.length];
  const seed = CATEGORY_SEEDS[Math.floor(k / TARGET_TOWNS.length) % CATEGORY_SEEDS.length];
  return { seed, town, facebookOnly: k % 3 !== 2 };
}

/** How many fresh rotation searches have already run — the next pair to
 *  search. Derived from the persisted search log, so it needs no extra
 *  state and survives restarts. */
function rotationCursor(ctx: SearchEconomyContext): number {
  return ctx.state.log.filter((e) => !e.cacheHit && e.purpose === 'PROSPECT_DISCOVERY' && e.entityId?.startsWith(AUTO_ENTITY_PREFIX)).length;
}

/** Automatic searches allowed per rolling 24h. The purpose's daily budget
 *  (searchBudget.ts, 16/day) keeps the rest free for the operator's own
 *  "Find clients" button, which would otherwise find the budget used up. */
const MAX_AUTO_SEARCHES_PER_DAY = 10;

function autoSearchesLast24h(ctx: SearchEconomyContext): number {
  const since = ctx.now - 24 * 60 * 60 * 1000;
  return ctx.state.log.filter((e) => !e.cacheHit && e.ts >= since && e.purpose === 'PROSPECT_DISCOVERY' && e.entityId?.startsWith(AUTO_ENTITY_PREFIX)).length;
}

const MAX_QUERIES_PER_CYCLE = 2;
const MAX_RESULTS_PER_QUERY = 10;
const MAX_NEW_PROSPECTS_PER_CYCLE = 12;

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
const COMMERCIAL_HINTS = ['open', 'hours', 'call us', 'call or whatsapp', 'whatsapp us', 'order', 'book now', 'booking', 'service', 'contact us', 'located', 'price', 'quote', 'deliver', 'visit us', 'followers', 'we offer', 'we specialise', 'we specialize'];
const URGENCY_HINTS = ['now open', 'new location', 'hiring', 'grand opening', 'coming soon', 'newly opened'];

function classifyPresence(domain: string, snippet: string): { presence: WebsitePresence; note: string } {
  const s = snippet.toLowerCase();
  if (domain.includes('facebook.com')) {
    return { presence: 'SOCIAL_ONLY', note: 'Primary public result is a Facebook page, not an independent website.' };
  }
  if (domain.includes('instagram.com')) {
    return { presence: 'SOCIAL_ONLY', note: 'Primary public result is an Instagram profile, not an independent website.' };
  }
  if (isWhatsAppDomain(domain)) {
    return { presence: 'SOCIAL_ONLY', note: 'Primary public presence is a WhatsApp Business link, not an independent website.' };
  }
  if (isSocialDomain(domain)) {
    return { presence: 'SOCIAL_ONLY', note: `Primary public result is a social profile (${domain}), not an independent website.` };
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

function classifyContact(
  domain: string,
  url: string,
  text: string,
  zimRegion: boolean,
  zimPhone: string | undefined,
): { channel: ContactChannel; value?: string } {
  if (zimPhone) return { channel: 'PHONE', value: zimPhone };
  // Outside Zimbabwe fall back to the generic pattern; inside Zimbabwe only a
  // real Zimbabwe number counts (years like "2011-2026", ranges like
  // "150 - 2000" and UK numbers were previously saved as phone numbers).
  const phoneMatch = zimRegion ? null : text.match(PHONE_RE);
  if (phoneMatch && looksLikeRealPhoneNumber(phoneMatch[1])) {
    return { channel: 'PHONE', value: phoneMatch[1].trim() };
  }
  if (domain.includes('wa.me') || /whatsapp/i.test(text)) return { channel: 'WHATSAPP', value: url };
  if (domain.includes('facebook.com')) return { channel: 'FACEBOOK', value: url };
  if (domain.includes('instagram.com')) return { channel: 'INSTAGRAM', value: url };
  if (domain) return { channel: 'WEBSITE_FORM', value: url };
  return { channel: 'UNKNOWN' };
}

export async function discoverProspects(
  ctx: SearchEconomyContext,
  opportunity: Opportunity,
  businessModel: BusinessModel | undefined,
  existingBusinessNames: string[],
  categoryStats?: CategoryRealWorldStats,
  now: number = Date.now(),
  options: { region?: string; searchQuery?: string } = {},
): Promise<{ prospects: Prospect[]; queriesRun: number; sourcesCount: number; cacheHits: number; budgetExceeded: number; rejected: number }> {
  const explicitRegion = options.region?.trim();
  // Each planned search: what to search for, where, and how.
  type PlannedSearch = { label: string; query: string; region: string; entityId: string };
  let plan: PlannedSearch[];
  if (options.searchQuery?.trim()) {
    const q = options.searchQuery.trim();
    const region = explicitRegion || opportunity.geographicRelevance[0] || 'Zimbabwe';
    plan = [
      { label: 'Targeted local business search', query: `${q} in ${region} phone WhatsApp`, region, entityId: `${opportunity.id}::targeted::${q}::${region}` },
      { label: 'Targeted local business (Facebook pages)', query: `site:facebook.com ${q} ${region}`, region, entityId: `${opportunity.id}::targeted-fb::${q}::${region}` },
    ];
  } else {
    const cursor = rotationCursor(ctx);
    const remainingToday = Math.max(0, MAX_AUTO_SEARCHES_PER_DAY - autoSearchesLast24h(ctx));
    plan = Array.from({ length: Math.min(MAX_QUERIES_PER_CYCLE, remainingToday) }, (_, i) => {
      const { seed, town, facebookOnly } = rotationPair(cursor + i);
      const region = explicitRegion || town;
      return {
        label: seed.label,
        query: facebookOnly ? `site:facebook.com ${seed.terms} ${region} Zimbabwe` : `${seed.terms} in ${region} Zimbabwe phone WhatsApp`,
        region,
        entityId: `${AUTO_ENTITY_PREFIX}${seed.label}::${region}::${facebookOnly ? 'fb' : 'web'}`,
      };
    });
  }
  const found: Prospect[] = [];
  let queriesRun = 0;
  let sourcesCount = 0;
  let cacheHits = 0;
  let budgetExceeded = 0;
  let rejected = 0;

  // Run the planned searches in parallel: sequential searches (plus inline
  // verification) took longer than the dashboard's request timeout, so the
  // "Find clients" button timed out and saved nothing (27 Sept 2026).
  const outcomes = await Promise.all(
    plan.map((seed) =>
      runSearch(ctx, {
        purpose: 'PROSPECT_DISCOVERY',
        // "site:facebook.com …" is turned into a Facebook-only domain filter by
        // the search provider; the other phrasing asks for business pages with
        // contact details, not guides or listicles.
        query: seed.query,
        entityId: seed.entityId,
        max: MAX_RESULTS_PER_QUERY,
      }),
    ),
  );

  for (const [planIndex, seed] of plan.entries()) {
    if (found.length >= MAX_NEW_PROSPECTS_PER_CYCLE) break;
    const region = seed.region;
    const zimRegion = /zimbabwe|harare|bulawayo|mutare|gweru|marondera|masvingo|chitungwiza|kwekwe|kadoma|ruwa|norton|bindura|rusape|chinhoyi/i.test(region);
    const searchOutcome = outcomes[planIndex];
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

      // Is this ONE real local business, and what is its actual name? Rejects
      // articles, listicles, guides, directories, review/aggregator sites,
      // foreign results and unattributable social posts (prospectResultFilter.ts).
      const judged = judgeSearchResult(r, region);
      if (!judged.ok) {
        rejected += 1;
        continue;
      }
      const businessName = judged.businessName;
      if (existingBusinessNames.some((n) => n.toLowerCase() === businessName.toLowerCase())) continue;
      if (found.some((p) => p.businessName.toLowerCase() === businessName.toLowerCase())) continue;

      const domain = extractDomain(r.url);
      const text = `${r.title} ${r.snippet}`;
      const { presence, note } = classifyPresence(domain, r.snippet);
      const { channel, value } = classifyContact(domain, r.url, text, zimRegion, judged.zimPhone);
      // A real Zimbabwe phone number in the business's own listing is itself a
      // sign of an operating business.
      const hasCommercialSignals = COMMERCIAL_HINTS.some((h) => text.toLowerCase().includes(h)) || Boolean(judged.zimPhone);
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

      // Already has its own website → not a lead for the website offer.
      // These used to be saved as DO_NOT_CONTACT rows that cluttered the CRM.
      if (presence === 'ADEQUATE') {
        rejected += 1;
        continue;
      }

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
          pricing: { category: seed.label, businessName, evidenceNotes: note },
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
        location: judged.location,
        websitePresence: presence,
        websiteUrl: undefined,
        // Keep the Facebook/Instagram/WhatsApp page so the operator can look
        // at it before messaging.
        socialLinks: isSocialDomain(domain) ? [r.url] : [],
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

  return { prospects: found, queriesRun, sourcesCount, cacheHits, budgetExceeded, rejected };
}
