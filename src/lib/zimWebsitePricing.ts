/* ============================================================================
 * Zimbabwe website market prices — a sourced reference table.
 * ----------------------------------------------------------------------------
 * Root cause this fixes (live D1, 27 Sept 2026): offers were priced from a
 * hard-coded ladder ($150/$250/$350/$450) chosen by keywords in the
 * OPPORTUNITY's text, so every prospect got the same price whatever the
 * business was; non-website opportunities fell through to a formula that
 * clamped to $50 (e-commerce setup quoted at $50, where the market charges
 * $300+); and live market research always stored $0–$0 because no LLM is
 * connected, so it was never used.
 *
 * These are real published Zimbabwe prices, checked 27 Sept 2026. Update the
 * table (and CHECKED_ON) when re-checking — do not invent numbers.
 * ========================================================================== */

import type { Prospect } from '../types';

export const CHECKED_ON = '2026-09-27';

export const MARKET_SOURCES = [
  { name: 'BizNest Technologies', url: 'https://www.biznest.co.zw/pricing', prices: 'Startup $100 · Small Business $150 · Medium $250 · Corporate $500 · support from $20/month' },
  { name: 'Public Methods', url: 'https://publicmethods.co.zw/web-development-zimbabwe/web-development-costs-prices/', prices: 'Blog $130 · Company $180 · Online store $300 · Custom $600+ (first-year hosting + .co.zw included)' },
  { name: 'TechTribe', url: 'https://techtribe.co.zw/pricing', prices: 'Starter $350 (5 pages) · Standard $550 (8 pages / online shop) · Premium $800+ · $75/year from year two' },
  { name: 'Fanadoh', url: 'https://fanadoh.com/product-category/web-design-zimbabwe/', prices: 'Standard $900 · Premium $1,200 (top of the market)' },
  { name: 'WebAura closed deals', url: '', prices: 'VenMax Car Rental $100 · Cultures Resort $220 incl. admin panel + $25/month care' },
] as const;

export type WebsiteTier = 'STARTER' | 'BUSINESS' | 'ORDERING_BOOKING' | 'ONLINE_STORE';

export interface TierPrice {
  tier: WebsiteTier;
  label: string;
  scope: string;
  /** What Zimbabwean providers publicly charge for this scope (budget → mid agencies). */
  marketMin: number;
  marketMax: number;
  /** WebAura's quote: lower-middle of the market — competitive while the
   *  portfolio is still small, but never below what we've already closed at. */
  quote: number;
  monthlyCare: number;
}

export const TIER_PRICES: Record<WebsiteTier, TierPrice> = {
  STARTER: {
    tier: 'STARTER',
    label: 'Starter site',
    scope: '1–3 pages, WhatsApp button, Google Business Profile setup',
    marketMin: 100,
    marketMax: 180,
    quote: 150,
    monthlyCare: 20,
  },
  BUSINESS: {
    tier: 'BUSINESS',
    label: 'Business website',
    scope: '4–6 pages: services, gallery, about, quote/contact form, WhatsApp',
    marketMin: 150,
    marketMax: 350,
    quote: 250,
    monthlyCare: 25,
  },
  ORDERING_BOOKING: {
    tier: 'ORDERING_BOOKING',
    label: 'Menu / booking website',
    scope: 'Menu or rooms/fleet, WhatsApp ordering or booking enquiries, simple admin to update it',
    marketMin: 220,
    marketMax: 550,
    quote: 300,
    monthlyCare: 25,
  },
  ONLINE_STORE: {
    tier: 'ONLINE_STORE',
    label: 'Online store',
    scope: 'Product catalogue, cart, EcoCash/Paynow or card payments, order admin',
    marketMin: 300,
    marketMax: 550,
    quote: 400,
    monthlyCare: 25,
  },
};

/** Pick the tier from what the business actually is. */
export function tierForProspect(p: Pick<Prospect, 'category' | 'businessName' | 'evidenceNotes'>): WebsiteTier {
  const text = `${p.category} ${p.businessName} ${p.evidenceNotes}`.toLowerCase();
  if (/online (shop|store)|e-?commerce|deliver(y|ies) nationwide|order online/.test(text)) return 'ONLINE_STORE';
  if (/restaurant|bakery|cafe|café|takeaway|food|hotel|lodge|guest ?house|b&b|hospitality|car (hire|rental)|tours?\b|salon booking|events? venue/.test(text)) return 'ORDERING_BOOKING';
  if (/salon|barber|braids|nails|photograph|tutor|makeup|personal services/.test(text)) return 'STARTER';
  return 'BUSINESS';
}

export function tierForOpportunityText(text: string): WebsiteTier {
  const t = text.toLowerCase();
  if (/e-?commerce|online store|online shop|payment gateway/.test(t)) return 'ONLINE_STORE';
  if (/booking|reservation|restaurant|hotel|guest house|car rental|menu/.test(t)) return 'ORDERING_BOOKING';
  if (/website|web design|web development|landing page|business site|online presence|digital service/.test(t)) return 'BUSINESS';
  return 'STARTER';
}

export function describeTierPrice(t: TierPrice): string {
  return (
    `${t.label} (${t.scope}): Zimbabwe market $${t.marketMin}–$${t.marketMax} once-off; ` +
    `WebAura quote $${t.quote} + optional $${t.monthlyCare}/month care plan. ` +
    `Sources checked ${CHECKED_ON}: ${MARKET_SOURCES.map((s) => `${s.name} (${s.prices})`).join('; ')}.`
  );
}

export function marketPriceForProspect(p: Pick<Prospect, 'category' | 'businessName' | 'evidenceNotes'>): TierPrice & { rationale: string } {
  const t = TIER_PRICES[tierForProspect(p)];
  return { ...t, rationale: describeTierPrice(t) };
}
