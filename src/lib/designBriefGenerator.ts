/* ============================================================================
 * SURVIVE AI — Design brief generator (Phase 3, §"OFFER + DELIVERY")
 * ----------------------------------------------------------------------------
 * Generates a structured, human-usable design brief (homepage concept, hero
 * section, logo direction, social graphics) for every drafted offer. No
 * image-generation integration is wired into this deployment, so
 * `assetStatus` always stays NOT_CONFIGURED here — the brief is complete
 * and useful to a human designer/operator regardless, and nothing here
 * fabricates a generated asset URL. Pure function, same shape as
 * offerGenerator.ts.
 * ========================================================================== */

import type { DesignBrief, Offer, Prospect } from '../types';
import { uid } from './format';

export function generateDesignBrief(offer: Offer, prospect: Prospect, now: number = Date.now()): DesignBrief {
  const category = prospect.category || 'local business';

  return {
    id: uid('brief'),
    offerId: offer.id,
    prospectId: prospect.id,
    homepageConcept: `Above-the-fold hero introducing ${prospect.businessName} in one sentence, immediately followed by the primary CTA. Below that: a short trust section (what makes this ${category.toLowerCase()} credible — years operating, location, specialty), then a preview of ${offer.websiteBrief.requiredSections.slice(1, 3).join(' and ')}, then a final CTA before the footer.`,
    heroSection: `Headline states what ${prospect.businessName} does and for whom, in plain language — no invented taglines. Subheadline adds one concrete differentiator the client actually confirms (e.g. location, specialty, years in business). One clear button: the same CTA defined in the offer's website brief.`,
    logoDirection: `If the client has an existing logo, use it as-is and build the palette around it. If not, a simple wordmark in a legible sans-serif is enough for v1 — logo design is out of scope for the base offer and should be scoped separately if the client wants a custom mark.`,
    socialGraphics: [
      `A square (1:1) profile-image variant of the logo/wordmark for social platforms`,
      `One "we're online" announcement graphic to post once the site is live`,
      `A simple contact-card graphic (business name, ${prospect.location}, contact channel) for sharing directly with customers`,
    ],
    colorDirectionNote: `Palette should come from any existing brand materials the client has (signage, packaging, prior logo). Absent that, default to two neutral tones plus one accent color that reads as trustworthy for a ${category.toLowerCase()} — avoid trend-driven choices that date quickly.`,
    assetStatus: 'NOT_CONFIGURED',
    generatedAt: now,
    updatedAt: now,
  };
}
