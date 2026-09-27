/* ============================================================================
 * SURVIVE AI — Offer + website brief generator (Phase 3, §"OFFER + DELIVERY")
 * ----------------------------------------------------------------------------
 * Turns an engaged, qualified prospect + its opportunity's business model
 * into a concrete, sendable package: price, timeline, deliverables, and a
 * full website brief (sitemap, copy direction, CTA strategy, brand
 * direction, SEO basics, required sections/assets). A gap analysis is only
 * ever included when the prospect's own stored evidence (websitePresence,
 * evidenceNotes) actually supports one — never fabricated.
 *
 * Pure function, same shape as businessModel.ts / outreachGenerator.ts.
 * Nothing here sends anything — the offer is a DRAFT until a human moves it
 * to SENT via the CRM write path.
 * ========================================================================== */

import type { BusinessModel, MarketPriceResearch, Offer, Prospect, ProspectIntelligence, WebsiteBrief } from '../types';
import { uid } from './format';
import { marketPriceForProspect } from './zimWebsitePricing';
import { isZimbabwePlace } from './prospectResultFilter';

/** Price order of trust:
 *  1. Live market research synthesized by an LLM and bounded by prices
 *     actually observed in the sources (non-LOW confidence).
 *  2. For Zimbabwe prospects: the sourced Zimbabwe market table, by what
 *     THIS business is (salon vs garage vs restaurant) — see zimWebsitePricing.ts.
 *  3. The business model's own estimate (last resort, flagged as such). */
function priceFor(
  prospect: Prospect,
  model: BusinessModel | undefined,
  marketPrice: MarketPriceResearch | undefined,
): { price: number; rationale?: string; monthlyCare?: number; scope?: string } {
  if (marketPrice && marketPrice.generator === 'llm' && marketPrice.confidence !== 'LOW' && marketPrice.priceMax > 0) {
    // Quote at the midpoint of the real researched range — a starting
    // point grounded in evidence, still adjustable in the real conversation.
    const price = Math.round((marketPrice.priceMin + marketPrice.priceMax) / 2);
    return { price, rationale: `Based on real market research: ${marketPrice.rationale}` };
  }
  if (isZimbabwePlace(`${prospect.location} ${model?.targetCustomer ?? ''}`)) {
    const t = marketPriceForProspect(prospect);
    return { price: t.quote, rationale: t.rationale, monthlyCare: t.monthlyCare, scope: t.scope };
  }
  return {
    price: model?.suggestedPrice ?? 150,
    rationale: `${model?.priceRationale ?? 'Formula estimate.'} Not checked against local market prices — confirm before quoting.`,
  };
}

function gapAnalysis(p: Prospect, intelligence?: ProspectIntelligence): string | undefined {
  const generic = (() => {
    switch (p.websitePresence) {
      case 'NONE_FOUND':
        return `No independent website was found for ${p.businessName} — customers currently have no way to find or evaluate the business online outside of ${p.contactChannel !== 'UNKNOWN' ? p.contactChannel.toLowerCase() : 'word of mouth'}.`;
      case 'SOCIAL_ONLY':
        return `${p.businessName}'s main online presence is a social page rather than an owned website — this limits control over first impressions, discoverability, and the ability to add a direct contact/booking path.`;
      case 'WEAK_OR_OUTDATED':
        return `${p.businessName}'s current website appears weak or outdated based on available evidence — a refresh would likely improve trust and conversion without needing to rebuild the business's existing brand from scratch.`;
      case 'ADEQUATE':
      case 'UNKNOWN':
      default:
        return undefined;
    }
  })();

  // Phase 6 — when genuine (AI-synthesized, non-LOW-confidence) deep
  // research exists on this specific business, fold its recommended angle
  // in alongside the generic presence-based gap analysis, rather than
  // replacing it — both are grounded in real evidence about this business.
  const problem = intelligence?.primaryProblem;
  if (problem && intelligence?.generator === 'llm' && intelligence.confidence !== 'LOW' && problem.confidence !== 'LOW' && problem.solvableOpportunity && problem.sourceIds.length > 0) {
    return [generic, `Evidence-backed opportunity: ${problem.solvableOpportunity}.`].filter(Boolean).join(' ');
  }
  return generic;
}

function sitemapFor(model: BusinessModel | undefined, category: string): string[] {
  const base = ['Home', 'About', 'Services / Products', 'Gallery / Portfolio', 'Contact'];
  if (/restaurant|food|cafe/i.test(category)) return ['Home', 'Menu', 'About', 'Gallery', 'Location & Hours', 'Contact / Reservations'];
  if (/real estate|property/i.test(category)) return ['Home', 'Listings', 'About', 'Agents', 'Contact'];
  if (/service/i.test(category)) return ['Home', 'Services', 'About', 'Testimonials', 'Contact / Quote Request'];
  if (model?.upsells?.length) return [...base, 'Special Offers'];
  return base;
}

function websiteBriefFor(prospect: Prospect, model: BusinessModel | undefined): WebsiteBrief {
  const offerLine = model?.offer ?? 'a professional, mobile-friendly website';
  const channel = prospect.contactChannel !== 'UNKNOWN' ? prospect.contactChannel : 'WhatsApp/phone';

  return {
    sitemap: sitemapFor(model, prospect.category),
    copyDirection: `Direct, trust-building copy in plain language — lead with what ${prospect.businessName} does and for whom, back it with concrete detail (location, hours, specialty), and close every section with a path to contact. Avoid generic filler; use only facts the client actually confirms.`,
    ctaStrategy: `Primary CTA repeated at top and bottom of every page: "Contact us on ${String(channel).toLowerCase()}" or a booking/quote-request form, whichever the client already uses day to day.`,
    brandDirection: model?.priceRationale
      ? `Visual tone should match the price point already set (${offerLine}) — clean and credible rather than flashy, so the site doesn't over- or under-promise relative to the real business.`
      : `Visual tone: clean, credible, mobile-first — matched to ${prospect.category.toLowerCase() || 'the business\'s'} category once the client confirms brand colors/logo.`,
    seoBasics: [
      `Page titles and meta descriptions naming "${prospect.businessName}" and "${prospect.location}"`,
      'Mobile-friendly, fast-loading pages (most local searches happen on phones)',
      'A Google Business Profile link/embed if one exists or is created',
      'Alt text on all images describing the business, not generic filler',
    ],
    requiredSections: sitemapFor(model, prospect.category),
    requiredAssets: [
      'Logo (existing file, or a simple wordmark if none exists)',
      'At least 5–10 real photos of the business/products/location',
      'Business hours, address, and contact details confirmed by the client',
      'Any existing brand colors or fonts, if the client has them',
    ],
  };
}

export function generateOffer(
  prospect: Prospect,
  model: BusinessModel | undefined,
  intelligence?: ProspectIntelligence,
  marketPrice?: MarketPriceResearch,
  now: number = Date.now(),
): Offer {
  const { price, rationale: priceRationale, monthlyCare, scope } = priceFor(prospect, model, marketPrice);
  const timelineDaysMax = Math.max(3, model?.timeToFirstSaleDaysEstimate ?? 14);
  const timelineDaysMin = Math.min(timelineDaysMax, Math.max(3, Math.round(timelineDaysMax * 0.5)));

  const deliverables = [
    `A ${sitemapFor(model, prospect.category).length}-page website (${sitemapFor(model, prospect.category).join(', ')})`,
    'Mobile-friendly, fast-loading design',
    'Basic on-page SEO (titles, meta descriptions, alt text)',
    `Contact/${prospect.contactChannel !== 'UNKNOWN' ? String(prospect.contactChannel).toLowerCase() : 'enquiry'} path on every page`,
    'One round of revisions before final delivery',
  ];
  if (scope) deliverables.unshift(`Scope: ${scope}`);
  if (monthlyCare) {
    deliverables.push(`Optional care plan: $${monthlyCare}/month (hosting, domain renewal, updates, small changes)`);
  } else if (model?.upsells?.length) {
    deliverables.push(...model.upsells.slice(0, 2));
  }

  return {
    id: uid('offer'),
    prospectId: prospect.id,
    prospectName: prospect.businessName,
    opportunityId: prospect.opportunityId,
    businessModelId: model?.id,
    price,
    priceRationale,
    timelineDaysMin,
    timelineDaysMax,
    deliverables,
    gapAnalysis: gapAnalysis(prospect, intelligence),
    websiteBrief: websiteBriefFor(prospect, model),
    status: 'DRAFT',
    generator: 'local-rule-engine',
    generatedAt: now,
    updatedAt: now,
  };
}
