/* ============================================================================
 * SURVIVE AI — Business Model Generator
 * ----------------------------------------------------------------------------
 * Converts a scored opportunity into a concrete, sellable offer: WHO, WHAT
 * PROBLEM, WHAT WE SELL, WHY THEY BUY, PRICE, CHANNEL, MESSAGE, DELIVERY,
 * PROFIT, SCALE, NEXT ACTION (build-spec §3). v1 is a transparent, auditable
 * local rule engine — same philosophy as services/ai.ts's generateReport():
 * never fabricates facts about a real business, everything is derived from
 * fields already verified/estimated on the opportunity itself. An LLM
 * provider can enrich the copy later without changing this shape.
 * ========================================================================== */

import type { BusinessModel, MemoryEntry, Opportunity } from '../types';
import { dayRange, uid } from './format';

const CHANNEL_BY_CATEGORY: Record<Opportunity['category'], string> = {
  'Local / Real-World':
    'Direct outreach (WhatsApp/phone/in-person) to local businesses, plus local Facebook/business groups and Google Business listings.',
  Services:
    'Direct outreach (WhatsApp/phone/email) to likely buyers, plus referrals from the first few clients.',
  'Digital Business': 'Content + SEO, relevant online communities, and direct outreach to a shortlist of ideal customers.',
  Content: 'Platform-native distribution (the content platform itself) plus cross-posting and direct audience outreach.',
  'E-Commerce': 'Social media (organic + small paid tests) and marketplace listings.',
  Finance: 'N/A — finance-category opportunities are research-only and are never taken to market by this system.',
};

const WEBSITE_PRICE_LADDER = {
  starter: 150,
  standard: 250,
  advanced: 350,
  custom: 450,
} as const;

function isWebsiteOpportunity(opp: Opportunity): boolean {
  const text = [opp.name, opp.description, opp.howMoneyMade, ...(opp.tags ?? [])].join(' ').toLowerCase();
  return /website|web design|web development|landing page|business site|web site|online presence|booking site|restaurant site|company site/.test(text);
}

function websitePrice(opp: Opportunity): { price: number; rationale: string } {
  const text = [opp.name, opp.description, opp.howMoneyMade, ...(opp.tags ?? [])].join(' ').toLowerCase();

  if (/e-?commerce|online store|shop|payment gateway|custom app|advanced booking|admin panel/.test(text)) {
    return { price: WEBSITE_PRICE_LADDER.custom, rationale: 'Configured NWT Dev pricing ladder: $450 for custom, e-commerce, advanced booking, payment or admin-panel scope.' };
  }
  if (/booking|reservation|restaurant|hotel|guest house|car rental|multi-page|5-page|cms|dashboard/.test(text)) {
    return { price: WEBSITE_PRICE_LADDER.advanced, rationale: 'Configured NWT Dev pricing ladder: $350 for an advanced business website with richer functionality or larger scope.' };
  }
  if (/business|company|contractor|service|4-page|four-page|5-page/.test(text)) {
    return { price: WEBSITE_PRICE_LADDER.standard, rationale: 'Configured NWT Dev pricing ladder: $250 for a standard business website.' };
  }
  return { price: WEBSITE_PRICE_LADDER.starter, rationale: 'Configured NWT Dev pricing ladder: $150 starter price for a smaller/basic web presence.' };
}

function estimatePrice(opp: Opportunity): { price: number; rationale: string } {
  if (isWebsiteOpportunity(opp)) return websitePrice(opp);
  const monthlyMid = (opp.revenuePotentialMonthlyMin + opp.revenuePotentialMonthlyMax) / 2;
  const raw = monthlyMid / 4;
  const price = Math.max(50, Math.min(500, Math.round(raw / 5) * 5));
  return {
    price,
    rationale: "Model-based estimate for a non-website service ($" + price + "). Not a verified market rate; live market-price research should replace it before quoting.",
  };
}

function objectionsFor(opp: Opportunity, price: number): { objection: string; response: string }[] {
  return [
    {
      objection: '"That\'s more than I want to spend."',
      response: `Reframe on outcome, not cost: "${opp.howMoneyMade}" — the price is small next to what a missed customer/lead is worth. Offer a smaller first-scope version at a lower price if needed, rather than discounting the full offer.`,
    },
    {
      objection: '"I don\'t know you / how do I know this will work?"',
      response: 'Offer a small, low-risk first deliverable (or a clear before/after example once you have one real case study) instead of asking for full trust up front.',
    },
    {
      objection: '"I need to think about it / talk to my partner."',
      response: 'Agree, and set a specific, low-pressure follow-up date (2–4 days) rather than leaving it open-ended — see the follow-up sequence below.',
    },
  ];
}

/**
 * Generate (or regenerate, as evidence improves) the concrete business model
 * behind a promising opportunity. Pure and deterministic — safe to call
 * every cycle; callers upsert the result keyed by opportunityId.
 */
export function generateBusinessModel(opp: Opportunity, memory: MemoryEntry[], now: number = Date.now()): BusinessModel {
  const { price, rationale } = estimatePrice(opp);
  const deliveryCostEstimate = Math.round(Math.min(opp.capitalRequiredMax, price * 0.3) * 100) / 100;
  const grossMarginPct = price > 0 ? Math.max(0, Math.min(95, Math.round(((price - deliveryCostEstimate) / price) * 100))) : 0;

  const region = opp.geographicRelevance[0] ?? 'the target market';
  const targetCustomer = `${region} — buyers matching: ${opp.description.split('.')[0]}.`;
  const problem = opp.downsideNote
    ? `The gap this exploits: ${opp.description}`
    : opp.description;

  const mem = memory.find((m) => m.kind === 'opportunity' && m.refId === opp.id);
  const confidence = Math.round(
    Math.min(
      0.95,
      0.3 +
        (opp.score?.total ?? 0) / 250 +
        (opp.evidenceTier === 'VERIFIED' ? 0.15 : opp.evidenceTier === 'LIKELY' ? 0.08 : 0) +
        (mem && mem.revenue > mem.spent ? 0.15 : 0),
    ) * 100,
  ) / 100;

  const salesMessage = `Hi — I help ${region.toLowerCase()} businesses like yours with: ${opp.name.toLowerCase()}. ${opp.howMoneyMade} Starting at $${price} for a first engagement, typically delivered within ${dayRange(
    opp.timeToRevenueDaysMin,
    opp.timeToRevenueDaysMax,
  )}. Would you be open to a quick conversation this week?`;

  const followUpSequence = [
    `Day 2–3: "Just following up on my message about ${opp.name.toLowerCase()} — happy to answer any questions, no pressure."`,
    `Day 5–7: "Wanted to check if now's a better time — I can also share a quick example of what this would look like for your business."`,
    `Day 12–14 (final): "Last check-in on this — if it's not a priority right now that's completely fine, feel free to reach out whenever it is."`,
  ];

  const upsells = [
    'Ongoing maintenance/support retainer (monthly)',
    'Volume/repeat-engagement discount to encourage recurring business',
    'Referral incentive for customers who introduce a new client',
  ];

  return {
    id: uid('bm'),
    opportunityId: opp.id,
    opportunityName: opp.name,

    targetCustomer,
    problem,
    offer: `${opp.name} — ${opp.howMoneyMade}`,
    whyTheyBuy: opp.upsideNote || `Addresses a real, named gap: ${opp.description.split('.')[0]}.`,

    suggestedPrice: price,
    priceRationale: rationale,
    deliveryCostEstimate,
    expectedGrossMarginPct: grossMarginPct,

    acquisitionChannel: CHANNEL_BY_CATEGORY[opp.category],
    salesMessage,
    followUpSequence,
    objectionHandling: objectionsFor(opp, price),

    deliveryWorkflow: `Scope the specific request → confirm price and timeline → deliver within ${dayRange(
      opp.timeToRevenueDaysMin,
      opp.timeToRevenueDaysMax,
    )} → collect payment on delivery (or a deposit up front for larger engagements) → ask for a testimonial/referral.`,
    timeToFirstSaleDaysEstimate: opp.timeToRevenueDaysMin,
    upsells,
    recurringRevenueNote:
      opp.scalability >= 3
        ? 'A recurring maintenance/retainer add-on is realistic for this model — offer it after the first successful delivery, not before trust is established.'
        : 'This model looks closer to one-off/project work — recurring revenue would need a deliberate retainer offer, not assume it happens naturally.',

    expectedProfitFirstDeal: Math.round((price - deliveryCostEstimate) * 100) / 100,
    canScale: opp.scalability >= 3 && !opp.executionBlocked,
    scaleNote:
      opp.scalability >= 4
        ? 'High modeled scalability — worth systematizing (templates, checklists) early so delivery time drops as volume grows.'
        : opp.scalability >= 3
          ? 'Moderate scalability — fine to grow linearly (more of your own time) before investing in systemizing it.'
          : 'Low modeled scalability — treat as a cash-generating side activity rather than a growth engine.',
    nextAction: `Identify 3–5 real ${region.toLowerCase()} businesses matching the target profile, verify their contact details, and send the sales message above.`,

    confidence,
    generator: 'local-rule-engine',
    generatedAt: mem ? now : now,
    updatedAt: now,
  };
}
