/* ============================================================================
 * Sales pricing — configurable, never invented.
 * ----------------------------------------------------------------------------
 * Prices live in the pricing_settings table and are edited from the Sales
 * screen. The defaults below are ONLY numbers WebAura has already grounded in
 * src/lib/zimWebsitePricing.ts (sourced Zimbabwe market table, checked 27 Sep
 * 2026, and WebAura's own closed deals). Anything not grounded is left null,
 * and any quote that needs it returns MANUAL_REVIEW_REQUIRED instead of a
 * made-up figure.
 * ========================================================================== */

import { TIER_PRICES } from '../lib/zimWebsitePricing';
import type { OfferType, PriceQuote, PricingKey, PricingSettings, QuoteLine } from './types';

export const PRICING_LABEL: Record<PricingKey, string> = {
  base_website_price: 'Base website',
  admin_panel_addon: 'Admin panel add-on',
  booking_addon: 'Booking add-on',
  ordering_addon: 'Ordering add-on',
  maintenance_monthly: 'Maintenance (per month)',
  domain_cost: 'Domain (per year)',
  hosting_cost: 'Hosting (per year)',
  custom_system_price: 'Custom system',
};

export const PRICING_HELP: Record<PricingKey, string> = {
  base_website_price: 'Once-off price of a standard business website.',
  admin_panel_addon: 'Extra for an admin panel so the client can edit content themselves.',
  booking_addon: 'Extra for booking / enquiry handling.',
  ordering_addon: 'Extra for menu or product ordering.',
  maintenance_monthly: 'Monthly care plan (updates, backups, small edits).',
  domain_cost: 'Yearly domain cost passed through to the client.',
  hosting_cost: 'Yearly hosting cost passed through to the client.',
  custom_system_price: 'Custom systems and automation are quoted per project — leave empty to force manual review.',
};

export function defaultPricing(): PricingSettings {
  const base = TIER_PRICES.BUSINESS.quote;
  const bookingOrdering = TIER_PRICES.ORDERING_BOOKING.quote;
  return {
    base_website_price: base,
    // The menu/booking tier ($300) minus the business tier ($250) is the
    // sourced difference for adding ordering or booking to a site.
    booking_addon: bookingOrdering - base,
    ordering_addon: bookingOrdering - base,
    maintenance_monthly: TIER_PRICES.BUSINESS.monthlyCare,
    // Not grounded in the market table → left for the owner to set.
    admin_panel_addon: null,
    domain_cost: null,
    hosting_cost: null,
    custom_system_price: null,
  };
}

interface Component { key: PricingKey; optional?: boolean; recurring?: QuoteLine['recurring'] }

const COMPONENTS: Record<OfferType, Component[]> = {
  WEBSITE: [{ key: 'base_website_price' }],
  BUSINESS_WEBSITE: [{ key: 'base_website_price' }],
  WEBSITE_ADMIN_PANEL: [{ key: 'base_website_price' }, { key: 'admin_panel_addon' }],
  BOOKING_SYSTEM: [{ key: 'base_website_price' }, { key: 'booking_addon' }],
  ORDERING_SYSTEM: [{ key: 'base_website_price' }, { key: 'ordering_addon' }],
  DIGITAL_CATALOGUE: [{ key: 'base_website_price' }],
  BUSINESS_AUTOMATION: [{ key: 'custom_system_price' }],
  WEBSITE_MAINTENANCE: [{ key: 'maintenance_monthly', recurring: 'MONTHLY' }],
  CUSTOM_BUSINESS_SYSTEM: [{ key: 'custom_system_price' }],
};

/** Build a quote from configured prices only. */
export function quoteOffer(offer: OfferType, pricing: PricingSettings): PriceQuote {
  const lines: QuoteLine[] = [];
  const missing: PricingKey[] = [];
  const push = (c: Component) => {
    const amount = pricing[c.key];
    lines.push({
      key: c.key,
      label: PRICING_LABEL[c.key],
      amount: typeof amount === 'number' && Number.isFinite(amount) ? amount : null,
      recurring: c.recurring ?? (c.key === 'domain_cost' || c.key === 'hosting_cost' ? 'YEARLY' : 'ONCE'),
      optional: Boolean(c.optional),
    });
    if (!c.optional && (typeof amount !== 'number' || !Number.isFinite(amount))) missing.push(c.key);
  };
  COMPONENTS[offer].forEach(push);

  // Optional monthly care and pass-through costs are shown when configured,
  // so the proposal is complete — but they never block a quote.
  if (offer !== 'WEBSITE_MAINTENANCE' && typeof pricing.maintenance_monthly === 'number') {
    push({ key: 'maintenance_monthly', optional: true, recurring: 'MONTHLY' });
  }
  for (const k of ['domain_cost', 'hosting_cost'] as PricingKey[]) {
    if (typeof pricing[k] === 'number') push({ key: k, optional: true, recurring: 'YEARLY' });
  }

  const oneOffTotal = lines
    .filter((l) => !l.optional && l.recurring === 'ONCE' && l.amount !== null)
    .reduce((s, l) => s + (l.amount as number), 0);
  const monthlyTotal = lines
    .filter((l) => !l.optional && l.recurring === 'MONTHLY' && l.amount !== null)
    .reduce((s, l) => s + (l.amount as number), 0);

  const manual = missing.length > 0;
  return {
    priceStatus: manual ? 'MANUAL_REVIEW_REQUIRED' : 'PRICED',
    lines,
    oneOffTotal,
    monthlyTotal,
    missing,
    note: manual
      ? `MANUAL_REVIEW_REQUIRED: set ${missing.map((k) => PRICING_LABEL[k]).join(', ')} in Sales → Settings, or price this by hand after discovery.`
      : 'Priced from your configured pricing settings.',
  };
}

export function mergePricing(stored: Partial<Record<string, number | null>> | undefined): PricingSettings {
  const base = defaultPricing();
  if (!stored) return base;
  for (const k of Object.keys(base) as PricingKey[]) {
    if (k in stored) {
      const v = stored[k];
      base[k] = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
    }
  }
  return base;
}
