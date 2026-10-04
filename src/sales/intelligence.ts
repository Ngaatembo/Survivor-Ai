/* ============================================================================
 * Sales intelligence — turns stored lead evidence into a structured brief.
 * ----------------------------------------------------------------------------
 * Pure functions. Nothing is invented: every statement is classified as
 *   VERIFIED  — read straight from a stored field, audit or operator entry
 *   INFERENCE — a reasoned guess (clearly labelled as such)
 *   UNKNOWN   — something the salesperson still has to find out
 * ========================================================================== */

import type { Prospect, ProspectIntelligence } from '../types';
import { displayName, parseZimPhone, prospectPhone } from '../lib/whatsappOutreach';
import { quoteOffer } from './pricing';
import {
  ANGLE_LABEL,
  CHANNEL_LABEL,
  type ChannelOption,
  type ChannelRecommendation,
  type CompanyProfile,
  type Confidence,
  type DemoRecommendation,
  type Fact,
  type OfferRecommendation,
  type OfferType,
  type PricingSettings,
  type QualificationResult,
  type SalesAngle,
  type SalesBrief,
  type SalesChannel,
  type SalesLeadRow,
} from './types';

export interface LeadContext {
  prospect: Prospect;
  intelligence?: ProspectIntelligence;
  /** Operator-entered contact details from the lead card. */
  lead?: Pick<SalesLeadRow, 'contactPerson' | 'phone' | 'whatsapp' | 'email'>;
  company: CompanyProfile;
  pricing: PricingSettings;
  now?: number;
}

/* ------------------------------ small helpers ------------------------------ */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const digits = (s: string | undefined | null) => (s ?? '').replace(/\D/g, '');

export type BizKind = 'BOOKING' | 'FOOD' | 'RETAIL' | 'TRADES' | 'PERSONAL' | 'PROFESSIONAL' | 'OTHER';

export function classifyBusiness(p: Pick<Prospect, 'category' | 'businessName'>): BizKind {
  const t = `${p.category} ${p.businessName}`.toLowerCase();
  if (/car (hire|rental)|rent-?a-?car|\btours?\b|safari|lodge|guest ?house|hotel|b&b|resort|villa|accommodation|venue|driving school|shuttle/.test(t)) return 'BOOKING';
  if (/restaurant|takeaway|bakery|caf[eé]|catering|kitchen|butcher|braai|pizza|coffee|grill|food/.test(t)) return 'FOOD';
  if (/\bshop\b|store|boutique|clothing|fashion|hardware|supplies|wholesale|retail|furniture|curtain|tailor|crochet|craft/.test(t)) return 'RETAIL';
  if (/auto ?body|panel ?beat|mechanic|garage|plumb|electric|construct|contractor|builder|renovat|paint|roof|weld|fabricat|tyre|towing|cleaning|landscap|solar|workshop/.test(t)) return 'TRADES';
  if (/salon|barber|braids|nails|beauty|\bspa\b|makeup|photograph|tutor|gym|fitness|massage/.test(t)) return 'PERSONAL';
  if (/clinic|dental|\blaw\b|attorney|account|consult|school|college|church|\bngo\b|real estate|insurance|pharmacy/.test(t)) return 'PROFESSIONAL';
  return 'OTHER';
}

const audit = (p: Prospect) => (p.verification?.websiteAudit?.status === 'AUDITED' ? p.verification.websiteAudit : undefined);
const isVerified = (p: Prospect) => p.verification?.status === 'VERIFIED';
const facebookLink = (p: Prospect) => p.socialLinks.find((u) => /facebook\.com/i.test(u));
const instagramLink = (p: Prospect) => p.socialLinks.find((u) => /instagram\.com/i.test(u));

/** Is there enough independent evidence to say "I couldn't find a website" to
 *  the business itself? Requires verified/provisional identity plus at least
 *  one independent source. Anything less → ask, don't assert. */
export function websiteClaimAllowed(p: Prospect): boolean {
  if (!isVerified(p)) return false;
  if (p.websitePresence !== 'NONE_FOUND' && p.websitePresence !== 'SOCIAL_ONLY') return false;
  return (p.verification?.independentSources ?? 0) >= 2 && p.sources.length >= 2;
}

/* ------------------------------- qualification ------------------------------ */

export function qualifyLead(ctx: LeadContext): QualificationResult {
  const p = ctx.prospect;
  const reasons: string[] = [];
  const blockers: string[] = [];

  if (p.priority === 'DO_NOT_CONTACT') blockers.push('Marked DO_NOT_CONTACT by discovery scoring.');
  if (p.verification?.status === 'CONFLICT') blockers.push('Business identity/contact evidence conflicts — resolve it before contacting.');
  else if (p.verification?.status !== 'VERIFIED') blockers.push('Business identity is not fully verified — provisional identity is not sufficient for contact approval.');
  else reasons.push(`Identity verified from ${p.verification?.independentSources ?? 0} independent source(s).`);

  const pp = ctx.intelligence?.primaryProblem;
  if (!ctx.intelligence) {
    blockers.push('Business intelligence has not been completed — do not invent a problem or sales angle.');
  } else if (!pp || pp.confidence === 'LOW' || !pp.evidence?.trim() || pp.sourceIds.length === 0 || !pp.outreachClaim?.trim()) {
    blockers.push('No sufficiently evidenced business-specific problem exists for a customer-facing claim.');
  } else {
    reasons.push(`Evidence-backed problem: ${pp.type} from ${pp.sourceIds.length} source(s), confidence ${pp.confidence}.`);
  }

  if (p.websitePresence === 'ADEQUATE' && audit(p)?.verdict === 'HEALTHY') {
    reasons.push('Existing website audits as healthy — a new-website pitch is not justified; use only a separately evidenced improvement/automation need.');
  }

  if (p.websitePresence === 'NONE_FOUND' || p.websitePresence === 'SOCIAL_ONLY') {
    if (!websiteClaimAllowed(p)) blockers.push('No-website/social-only claim lacks sufficient independent evidence.');
    else reasons.push('No own website claim is supported by at least two independent discovery sources.');
  }

  if (p.priority === 'HIGH' || p.priority === 'MEDIUM') reasons.push(`Discovery priority ${p.priority} (score ${p.score.total}/100).`);
  else if (p.score.total >= 40) reasons.push(`Lead score ${p.score.total}/100.`);
  else blockers.push(`Low lead score (${p.score.total}/100) and LOW priority.`);

  return { qualified: blockers.length === 0, reasons, blockers };
}

/* --------------------------------- channels --------------------------------- */

const CHANNEL_BASE_SCORE: Record<SalesChannel, number> = {
  WHATSAPP: 100, PHONE_CALL: 80, FACEBOOK_MESSENGER: 60, INSTAGRAM_DM: 55, EMAIL: 50, WEBSITE_FORM: 35, PHYSICAL_VISIT: 30,
};

export function recommendChannel(ctx: LeadContext): ChannelRecommendation {
  const p = ctx.prospect;
  const lead = ctx.lead;
  const v = p.verification;
  const options: (ChannelOption & { score: number })[] = [];
  const warnings: string[] = [];

  const opNumber = parseZimPhone(lead?.whatsapp) ?? parseZimPhone(lead?.phone);
  const phone = opNumber ?? prospectPhone(p);
  const phoneFromOperator = Boolean(opNumber);
  const phoneVerified =
    phoneFromOperator ||
    (phone !== null && digits(v?.verifiedContactValue).endsWith(phone.international.slice(3)) && digits(v?.verifiedContactValue).length > 0);

  const hasWaLink = p.socialLinks.some((u) => /wa\.me|whatsapp\.com/i.test(u)) || /whatsapp business link/i.test(p.evidenceNotes);
  const waNumber = parseZimPhone(lead?.whatsapp);
  const source = phoneFromOperator ? 'entered by you on the lead card' : phoneVerified ? 'independently verified' : 'on record but not independently verified';

  if (phone && (phone.isMobile || waNumber || hasWaLink)) {
    options.push({
      channel: 'WHATSAPP',
      target: phone.display,
      targetVerified: phoneVerified,
      score: CHANNEL_BASE_SCORE.WHATSAPP + (phoneVerified ? 10 : 0),
      reason: `A mobile number (${phone.display}, ${source}) is available and mobile numbers in Zimbabwe are normally on WhatsApp. WhatsApp usually gets a faster, more direct reply than email (inference).`,
    });
  }
  if (phone) {
    const landlineOnly = !phone.isMobile && !waNumber && !hasWaLink;
    options.push({
      channel: 'PHONE_CALL',
      target: phone.display,
      targetVerified: phoneVerified,
      score: CHANNEL_BASE_SCORE.PHONE_CALL + (phoneVerified ? 10 : 0) + (landlineOnly ? 15 : 0),
      reason: landlineOnly
        ? `Only a landline (${phone.display}, ${source}) is available, so WhatsApp is not an option — calling is the direct route.`
        : `A phone number (${phone.display}, ${source}) is available for a call.`,
    });
  }
  const fb = facebookLink(p);
  if (fb) {
    options.push({
      channel: 'FACEBOOK_MESSENGER', target: fb, targetVerified: false,
      score: CHANNEL_BASE_SCORE.FACEBOOK_MESSENGER,
      reason: 'A Facebook page is on record; a Messenger message reaches the page inbox, which small businesses often check less reliably than WhatsApp (inference).',
    });
  }
  const ig = instagramLink(p);
  if (ig) {
    options.push({
      channel: 'INSTAGRAM_DM', target: ig, targetVerified: false,
      score: CHANNEL_BASE_SCORE.INSTAGRAM_DM,
      reason: 'An Instagram profile is on record; a DM is possible but replies can be slow if the account is not actively managed (inference).',
    });
  }
  const email = [lead?.email, v?.verifiedEmail, p.contactChannel === 'EMAIL' ? p.contactValue : undefined].find((e) => e && EMAIL_RE.test(e));
  if (email) {
    const verifiedEmail = Boolean(lead?.email === email || v?.verifiedEmail === email);
    options.push({
      channel: 'EMAIL', target: email, targetVerified: verifiedEmail,
      score: CHANNEL_BASE_SCORE.EMAIL + (verifiedEmail ? 10 : 0),
      reason: `An email address (${email}) is available. Email works, but small Zimbabwean businesses tend to answer WhatsApp and calls faster.`,
    });
  }
  const siteUrl = v?.verifiedWebsiteUrl || p.websiteUrl;
  if (siteUrl && audit(p)?.checks.contactPath) {
    options.push({
      channel: 'WEBSITE_FORM', target: siteUrl, targetVerified: true,
      score: CHANNEL_BASE_SCORE.WEBSITE_FORM,
      reason: 'Their website has a contact path (per the website audit). A form message is the weakest option — it may not be monitored.',
    });
  }
  if (v?.verifiedLocation && new RegExp(ctx.company.homeTown, 'i').test(v.verifiedLocation)) {
    options.push({
      channel: 'PHYSICAL_VISIT', target: v.verifiedLocation, targetVerified: true,
      score: CHANNEL_BASE_SCORE.PHYSICAL_VISIT,
      reason: `The verified location (${v.verifiedLocation}) is in ${ctx.company.homeTown}, so an in-person visit is possible.`,
    });
  }

  if (options.length === 0) {
    return {
      status: 'NO_DIRECT_CHANNEL',
      reason: 'No phone, WhatsApp, email, social page, website contact form or visitable verified address is on record.',
      fallbacks: [],
      warnings: [],
      nextStep: 'Find decision-maker/contact information manually.',
    };
  }

  options.sort((a, b) => b.score - a.score);
  const [best, ...rest] = options;
  if (!best.targetVerified && best.channel !== 'FACEBOOK_MESSENGER' && best.channel !== 'INSTAGRAM_DM') {
    warnings.push('This contact detail is not independently verified — confirm it belongs to the business before relying on it.');
  }
  if (best.channel === 'FACEBOOK_MESSENGER' || best.channel === 'INSTAGRAM_DM') {
    warnings.push('Only a social page is available: there is no verified phone number. Try to find a WhatsApp/phone number on the page.');
  }
  const strip = ({ score: _s, ...o }: ChannelOption & { score: number }): ChannelOption => o;
  return {
    status: 'RECOMMENDED',
    channel: best.channel,
    reason: best.reason,
    target: best.target,
    targetVerified: best.targetVerified,
    fallbacks: rest.map(strip),
    warnings,
  };
}

/* ---------------------------------- angles ---------------------------------- */

interface AngleFinding { angle: SalesAngle; strength: number; evidence: Fact[]; reason: string }

const v = (text: string, source: string): Fact => ({ kind: 'VERIFIED', text, source });
const inf = (text: string): Fact => ({ kind: 'INFERENCE', text });
const unk = (text: string): Fact => ({ kind: 'UNKNOWN', text });

export function detectAngles(ctx: LeadContext): AngleFinding[] {
  const p = ctx.prospect;
  const a = audit(p);
  const kind = classifyBusiness(p);
  const bookingSuited = kind === 'BOOKING' || kind === 'PERSONAL' || kind === 'PROFESSIONAL' || kind === 'FOOD';
  const out: AngleFinding[] = [];
  const claim = websiteClaimAllowed(p);
  const hasSocial = p.socialLinks.length > 0;

  if (a) {
    if (a.checks.mobileViewport === false) {
      out.push({ angle: 'POOR_MOBILE', strength: 92, reason: 'The website audit found no mobile viewport setup.', evidence: [v('Website audit: no mobile-friendly viewport detected.', 'website audit')] });
    }
    if ((a.score !== undefined && a.score < 50) || a.criticalIssues.length >= 2 || a.checks.https === false) {
      out.push({ angle: 'OUTDATED_WEBSITE', strength: 88, reason: 'The website audit flagged critical issues.', evidence: [v(`Website audit score ${a.score ?? 'n/a'}/100; issues: ${a.criticalIssues.slice(0, 3).join('; ') || (a.checks.https ? 'none listed' : 'no HTTPS')}.`, 'website audit')] });
    }
    if (a.checks.reachable && a.checks.contactPath === false) {
      out.push({ angle: 'POOR_CONVERSION_PATH', strength: a.checks.conversionPath === false ? 90 : 84, reason: 'The website has no clear way for a customer to get in touch.', evidence: [v('Website audit: no clear contact path on the first page.', 'website audit')] });
    }
    if (a.checks.reachable && a.checks.conversionPath === false) {
      out.push({ angle: 'NO_ENQUIRY_OR_BOOKING', strength: bookingSuited ? 85 : 60, reason: 'The website has no booking/enquiry/order action.', evidence: [v('Website audit: no enquiry, booking or order action found.', 'website audit')] });
    }
    if (a.checks.reachable && a.checks.serviceEvidence === false) {
      out.push({ angle: 'NO_SERVICE_CATALOGUE', strength: 80, reason: 'The website does not clearly list services or products.', evidence: [v('Website audit: services/products are not clearly presented.', 'website audit')] });
    }
    if (a.checks.reachable && (a.checks.title === false || a.checks.metaDescription === false)) {
      out.push({ angle: 'WEAK_SEARCH_PRESENCE', strength: 65, reason: 'The website is missing basic search-listing text.', evidence: [v('Website audit: missing page title and/or meta description.', 'website audit')] });
    }
    if (p.websitePresence === 'ADEQUATE' && ((a.score ?? 100) < 85 || a.opportunities.length > 0)) {
      out.push({ angle: 'IMPROVABLE_WEBSITE', strength: 66, reason: 'The existing website works but the audit found room to improve it.', evidence: [v(`Website audit score ${a.score ?? 'n/a'}/100 with ${a.opportunities.length} improvement opportunity(ies).`, 'website audit')] });
    }
  }

  if (p.websitePresence === 'NONE_FOUND') {
    out.push({
      angle: 'NO_WEBSITE', strength: claim ? 85 : 45,
      reason: claim ? 'No website was found and the business identity is verified with independent sources.' : 'No website was found, but the evidence is too thin to state that to the business.',
      evidence: [claim
        ? v('No website found for this business in discovery/verification searches (search-based, not exhaustive).', 'discovery search')
        : inf('No website found in discovery, but identity/independent-source evidence is thin — confirm before asserting it.')],
    });
  }
  if (p.websitePresence === 'SOCIAL_ONLY' && hasSocial) {
    out.push({
      angle: 'SOCIAL_NO_CENTRAL_SITE', strength: claim ? 82 : 50,
      reason: claim ? 'The business is present on social media but no website of its own was found.' : 'Social presence found but no own website was confirmed — evidence is thin.',
      evidence: [
        v(`Social page(s) on record: ${p.socialLinks.slice(0, 3).join(', ')}.`, 'discovery'),
        claim ? v('No own website found in discovery/verification searches (search-based, not exhaustive).', 'discovery search') : inf('No own website found, but this is not confirmed by independent sources.'),
      ],
    });
  }
  if (p.websitePresence === 'WEAK_OR_OUTDATED' && !out.some((f) => f.angle === 'OUTDATED_WEBSITE')) {
    out.push({ angle: 'OUTDATED_WEBSITE', strength: 70, reason: 'Discovery classified the existing website as weak or outdated.', evidence: [inf('Discovery classified the website as weak/outdated (no detailed audit on record).')] });
  }
  if (['NONE_FOUND', 'SOCIAL_ONLY', 'WEAK_OR_OUTDATED'].includes(p.websitePresence) && (p.verification?.independentSources ?? 0) >= 2) {
    out.push({ angle: 'ESTABLISHED_WEAK_DIGITAL', strength: 62, reason: 'Several independent sources mention the business, which suggests it is established.', evidence: [inf(`Mentioned by ${p.verification?.independentSources} independent sources, so the business appears established — but its digital presence is thin.`)] });
  }
  if (p.websitePresence === 'ADEQUATE' && a?.verdict === 'HEALTHY' && (kind === 'BOOKING' || kind === 'TRADES' || kind === 'PROFESSIONAL')) {
    out.push({ angle: 'AUTOMATION_OPPORTUNITY', strength: 45, reason: 'The website is healthy; the remaining opportunity is operational (bookings, quotes, admin) and needs discovery to confirm.', evidence: [inf('Healthy website; a management/automation system might help, but this needs a conversation to confirm.')] });
  }

  // A synthesised primary problem with cited sources can support an angle too.
  const pp = ctx.intelligence?.primaryProblem;
  if (pp && pp.confidence !== 'LOW' && pp.sourceIds.length > 0) {
    const map: Partial<Record<typeof pp.type, SalesAngle>> = {
      DISCOVERABILITY: 'WEAK_SEARCH_PRESENCE', CONVERSION: 'POOR_CONVERSION_PATH', LEAD_CAPTURE: 'POOR_CONVERSION_PATH',
      BOOKING: 'NO_ENQUIRY_OR_BOOKING', ORDERING: 'NO_ENQUIRY_OR_BOOKING', WEBSITE_QUALITY: 'OUTDATED_WEBSITE',
    };
    const angle = map[pp.type];
    if (angle && !out.some((f) => f.angle === angle)) {
      out.push({ angle, strength: pp.confidence === 'HIGH' ? 75 : 68, reason: `Research identified: ${pp.businessFriction}`, evidence: [inf(`Research (${pp.confidence.toLowerCase()} confidence, ${pp.sourceIds.length} source(s)): ${pp.evidence}`)] });
    }
  }

  return out.sort((x, y) => y.strength - x.strength);
}

/* ---------------------------------- offers ---------------------------------- */

const OFFER_FEATURES: Record<OfferType, { necessary: string[]; optional: string[] }> = {
  WEBSITE: {
    necessary: ['1–3 pages: what you do, where you are, how to reach you', 'One-tap WhatsApp/call button', 'Works properly on phones'],
    optional: ['Google Business Profile setup', 'Photo gallery'],
  },
  BUSINESS_WEBSITE: {
    necessary: ['Services page', 'About and location', 'Contact / WhatsApp button', 'Mobile-friendly design'],
    optional: ['Photo gallery', 'Enquiry form', 'Google Business Profile setup', 'Admin panel'],
  },
  WEBSITE_ADMIN_PANEL: {
    necessary: ['Business website', 'Simple admin panel so the owner can edit content without a developer'],
    optional: ['Booking or ordering add-on', 'Monthly care plan'],
  },
  BOOKING_SYSTEM: {
    necessary: ['Business website', 'Booking/enquiry form that reaches the owner instantly', 'Confirmation message to the customer'],
    optional: ['Admin panel to manage bookings', 'Calendar/availability view', 'Payment link'],
  },
  ORDERING_SYSTEM: {
    necessary: ['Menu/product pages', 'Order or enquiry via WhatsApp', 'Owner notification'],
    optional: ['Admin panel to update items and prices', 'Online payment', 'Delivery details'],
  },
  DIGITAL_CATALOGUE: {
    necessary: ['Clear product/service catalogue with photos', 'WhatsApp "ask / order" button', 'Mobile-friendly'],
    optional: ['Online ordering', 'Admin panel to update the catalogue'],
  },
  BUSINESS_AUTOMATION: {
    necessary: ['A confirmed, specific process to automate (found in discovery)'],
    optional: ['Automatic quotes/invoices', 'Customer reminders', 'Reporting'],
  },
  WEBSITE_MAINTENANCE: {
    necessary: ['Fixes for the specific issues found in the audit', 'Hosting/backups check'],
    optional: ['Monthly care plan', 'Content updates', 'Search-listing improvements'],
  },
  CUSTOM_BUSINESS_SYSTEM: {
    necessary: ['A scoped requirements document agreed with the client'],
    optional: ['Admin dashboard', 'Integrations', 'Staff accounts'],
  },
};

export function recommendOffer(ctx: LeadContext, angle: SalesAngle): OfferRecommendation {
  const kind = classifyBusiness(ctx.prospect);
  let offer: OfferType;
  let why: string;
  let solves: string;
  let lighter: OfferType | undefined;

  switch (angle) {
    case 'NO_ENQUIRY_OR_BOOKING':
      offer = kind === 'FOOD' || kind === 'RETAIL' ? 'ORDERING_SYSTEM' : 'BOOKING_SYSTEM';
      why = 'The audit shows customers have no way to enquire, book or order online.';
      solves = 'Customers who visit the site currently have nowhere to act, so interest is lost.';
      lighter = 'WEBSITE_MAINTENANCE';
      break;
    case 'NO_SERVICE_CATALOGUE':
      offer = 'DIGITAL_CATALOGUE';
      why = 'The site does not make clear what the business sells.';
      solves = 'Customers cannot quickly see services/products and prices-on-request.';
      lighter = 'WEBSITE_MAINTENANCE';
      break;
    case 'POOR_CONVERSION_PATH':
    case 'IMPROVABLE_WEBSITE':
    case 'WEAK_SEARCH_PRESENCE':
      offer = 'WEBSITE_MAINTENANCE';
      why = 'A website exists, so the smallest useful step is fixing the specific issues found rather than rebuilding it.';
      solves = 'Removes the specific gaps (contact path, search listing, page quality) that lose customers today.';
      lighter = undefined;
      break;
    case 'OUTDATED_WEBSITE':
    case 'POOR_MOBILE':
      offer = 'BUSINESS_WEBSITE';
      why = 'The current site is hard to use (especially on phones), and most local customers browse on mobile.';
      solves = 'Gives customers a fast, mobile-friendly site with a clear way to contact the business.';
      lighter = 'WEBSITE';
      break;
    case 'AUTOMATION_OPPORTUNITY':
      offer = 'BUSINESS_AUTOMATION';
      why = 'The website is healthy, so any further value has to come from operations — only worth raising after learning how the business runs.';
      solves = 'Reduces repetitive admin (quotes, bookings, reminders) — to be confirmed in conversation.';
      lighter = 'WEBSITE_MAINTENANCE';
      break;
    case 'CONVERSATION_FIRST':
      offer = 'WEBSITE';
      why = 'There is not enough evidence to know what this business needs, so the lightest offer is a placeholder until a conversation confirms the need.';
      solves = 'To be confirmed in conversation.';
      lighter = undefined;
      break;
    default: // NO_WEBSITE, SOCIAL_NO_CENTRAL_SITE, ESTABLISHED_WEAK_DIGITAL
      if (kind === 'FOOD' || kind === 'RETAIL') {
        offer = 'DIGITAL_CATALOGUE';
        why = 'They sell products/food that customers want to browse; a catalogue with a WhatsApp order button covers the need without a full store.';
        solves = 'Customers find the business online and can see what is offered and ask/order in one tap.';
        lighter = 'WEBSITE';
      } else if (kind === 'PERSONAL') {
        offer = 'WEBSITE';
        why = 'A small personal-service business usually needs a simple, affordable page with contact and gallery, not a large build.';
        solves = 'Customers searching for the service can find it and reach out easily.';
        lighter = undefined;
      } else {
        offer = 'BUSINESS_WEBSITE';
        why = 'Customers currently have no central, professional place to see services, location and contact details.';
        solves = 'Customers who search for the business can find it, see what it offers and contact it in one tap.';
        lighter = 'WEBSITE';
      }
  }

  const features = OFFER_FEATURES[offer];
  const optional = [...features.optional];
  // Add-ons are OPTIONAL suggestions, never bundled into the base recommendation.
  if ((kind === 'BOOKING' || kind === 'PROFESSIONAL') && !['BOOKING_SYSTEM', 'BUSINESS_AUTOMATION'].includes(offer)) optional.push('Booking/enquiry add-on');
  if (offer === 'WEBSITE_MAINTENANCE') optional.push('One-off improvements are quoted manually after review');

  return {
    offer,
    whyThisOffer: why,
    problemSolved: solves,
    necessaryFeatures: features.necessary,
    optionalFeatures: optional,
    lighterAlternative: lighter,
    quote: quoteOffer(offer, ctx.pricing),
  };
}

/* ----------------------------------- demo ----------------------------------- */

const DEMO_ANGLES: SalesAngle[] = ['NO_WEBSITE', 'SOCIAL_NO_CENTRAL_SITE', 'OUTDATED_WEBSITE', 'POOR_MOBILE', 'ESTABLISHED_WEAK_DIGITAL', 'POOR_CONVERSION_PATH', 'NO_ENQUIRY_OR_BOOKING'];

export function recommendDemo(
  ctx: LeadContext,
  angle: SalesAngle,
  confidence: Confidence,
  channel: ChannelRecommendation,
  qualified: boolean,
): DemoRecommendation {
  const kind = classifyBusiness(ctx.prospect);
  const sections = ['Home', 'Services', 'Gallery', 'About'];
  if (kind === 'FOOD' || kind === 'RETAIL') sections.splice(1, 1, 'Menu / Products');
  if (kind === 'BOOKING') sections.push('Booking enquiry');
  sections.push('Contact / WhatsApp');

  const reasons: string[] = [];
  if (!qualified) reasons.push('the lead is not qualified yet');
  if (confidence === 'LOW') reasons.push('confidence in the evidence is low');
  if (channel.status !== 'RECOMMENDED') reasons.push('there is no direct contact channel to send a demo through');
  if (!DEMO_ANGLES.includes(angle)) reasons.push('the opportunity is not clearly visual — it should be explored in conversation first');

  if (reasons.length > 0) {
    return {
      recommended: false,
      reason: `Lead should first be qualified through conversation: ${reasons.join('; ')}.`,
      suggestedSections: [],
    };
  }
  const pages = sections.length;
  return {
    recommended: true,
    reason: `The opportunity (${ANGLE_LABEL[angle].toLowerCase()}) is visual and the evidence is ${confidence.toLowerCase()} confidence. Showing a relevant example is likely to communicate the opportunity better than a text pitch.`,
    suggestedDemo: `${pages}-section business website preview`,
    suggestedSections: sections,
  };
}

/* ------------------------------ facts & approach ----------------------------- */

export function collectEvidence(ctx: LeadContext): Fact[] {
  const p = ctx.prospect;
  const a = audit(p);
  const facts: Fact[] = [];

  facts.push(v(`Business: ${displayName(p)}${p.category ? ` (${p.category})` : ''}${p.location ? `, ${p.location}` : ''}.`, 'lead record'));
  if (isVerified(p)) {
    facts.push(v(`Identity ${p.verification!.status.toLowerCase()} — ${p.verification!.independentSources} independent source(s), confidence ${p.verification!.confidence}/100.`, 'verification'));
  } else {
    facts.push(unk('Business identity has not been verified.'));
  }

  const presenceText: Record<Prospect['websitePresence'], Fact> = {
    NONE_FOUND: websiteClaimAllowed(p)
      ? v('No website found in discovery/verification searches (search-based, not exhaustive).', 'discovery search')
      : inf('No website found in discovery, but the evidence is thin.'),
    SOCIAL_ONLY: websiteClaimAllowed(p)
      ? v('Only social pages found — no own website in discovery/verification searches.', 'discovery search')
      : inf('Only social pages found; no own website confirmed.'),
    WEAK_OR_OUTDATED: inf('Discovery classified the existing website as weak or outdated.'),
    ADEQUATE: v('An adequate website exists.', 'discovery'),
    UNKNOWN: unk('Whether the business has a website is unknown.'),
  };
  facts.push(presenceText[p.websitePresence]);

  if (a) {
    facts.push(v(`Website audit ${a.score ?? 'n/a'}/100 (${a.verdict ?? 'no verdict'}).${a.criticalIssues.length ? ` Issues: ${a.criticalIssues.slice(0, 3).join('; ')}.` : ''}`, 'website audit'));
  }
  if (p.socialLinks.length) {
    facts.push(v(`Social presence on record: ${p.socialLinks.slice(0, 3).join(', ')}. Posting activity is not verified.`, 'discovery'));
  }
  const svc = ctx.intelligence?.apparentServices ?? [];
  if (svc.length && ctx.intelligence?.confidence !== 'LOW') {
    facts.push(inf(`Services appear to include: ${svc.slice(0, 5).join(', ')} (from public snippets, not confirmed by the owner).`));
  }
  if (ctx.intelligence?.specificProblemEvidence) {
    facts.push(inf(`Research note: ${ctx.intelligence.specificProblemEvidence}`));
  }
  facts.push(unk('Budget and appetite for a website/system are unknown.'));
  return facts;
}

export function decisionMakerFact(ctx: LeadContext): Fact {
  const name = ctx.lead?.contactPerson?.trim();
  if (name) return v(`Contact person: ${name}.`, 'entered by you on the lead card');
  return unk('Decision-maker not identified — ask who handles marketing/the website when you first speak.');
}

const APPROACH: Record<SalesAngle, string> = {
  NO_WEBSITE: 'Explain the customer-side problem: people who search for this kind of business cannot find a page of their own. Offer to show what it could look like rather than pitching a price.',
  SOCIAL_NO_CENTRAL_SITE: 'Acknowledge the social page as a good start, then explain what a central site adds (found on Google, services and contact in one place). Do not criticise their page.',
  OUTDATED_WEBSITE: 'Lead with the customer experience of the current site (specific audit findings), not with "your site is bad". Offer a refreshed example.',
  POOR_MOBILE: 'Point out — gently and specifically — that the site is hard to use on a phone, where most local customers browse. Offer a quick before/after.',
  WEAK_SEARCH_PRESENCE: 'Explain that basic search-listing details are missing so Google shows the site poorly. Offer a quick fix.',
  NO_ENQUIRY_OR_BOOKING: 'Talk about customers who visit and have no simple way to enquire, book or order. Ask how they currently take enquiries.',
  NO_SERVICE_CATALOGUE: 'Ask what customers most often ask for, then explain that a clear catalogue answers those questions before they even call.',
  POOR_CONVERSION_PATH: 'Focus on the moment a customer decides to get in touch and the path from the site to a conversation.',
  ESTABLISHED_WEAK_DIGITAL: 'Recognise the business is established (only if you can point to evidence) and explain that its online presence has not caught up.',
  IMPROVABLE_WEBSITE: 'Respect the existing site. Offer 1–2 specific improvements from the audit, not a rebuild.',
  AUTOMATION_OPPORTUNITY: 'Do not pitch. Ask how enquiries, bookings and quotes are handled today and listen for repetitive admin.',
  CONVERSATION_FIRST: 'There is not enough evidence to make a claim. Open with a genuine question about how customers find them today.',
};

function opportunityLine(angle: SalesAngle, p: Prospect): string {
  const name = displayName(p);
  switch (angle) {
    case 'NO_WEBSITE': return websiteClaimAllowed(p) ? 'No official website was found for this business.' : 'No website was found in discovery — needs confirming with the owner.';
    case 'SOCIAL_NO_CENTRAL_SITE': return 'Active on social pages but no central website of its own was found.';
    case 'OUTDATED_WEBSITE': return 'Existing website looks outdated or has significant issues.';
    case 'POOR_MOBILE': return 'Existing website is not set up for mobile visitors.';
    case 'WEAK_SEARCH_PRESENCE': return 'Existing website is missing basic search-listing details.';
    case 'NO_ENQUIRY_OR_BOOKING': return 'Existing website gives customers no enquiry, booking or ordering action.';
    case 'NO_SERVICE_CATALOGUE': return 'Existing website does not clearly present services or products.';
    case 'POOR_CONVERSION_PATH': return 'Existing website has no clear contact path.';
    case 'ESTABLISHED_WEAK_DIGITAL': return `${name} appears established but its digital presence is thin.`;
    case 'IMPROVABLE_WEBSITE': return 'Existing website works but could be improved.';
    case 'AUTOMATION_OPPORTUNITY': return 'Website is healthy; possible opportunity in business operations (unconfirmed).';
    default: return 'Not enough evidence to identify a specific opportunity yet.';
  }
}

/* ----------------------------------- brief ---------------------------------- */

export function buildSalesBrief(ctx: LeadContext): SalesBrief {
  const p = ctx.prospect;
  const now = ctx.now ?? Date.now();
  const findings = detectAngles(ctx);
  const top = findings[0];
  const chosen = top && top.strength >= 60 ? top : undefined;
  const angle: SalesAngle = chosen?.angle ?? 'CONVERSATION_FIRST';
  const secondary = findings.filter((f) => f.angle !== angle && f.strength >= 55).slice(0, 2).map((f) => f.angle);

  const channel = recommendChannel(ctx);
  const qualification = qualifyLead(ctx);

  // Confidence: evidence-based points, explained.
  let points = 0;
  const why: string[] = [];
  if (p.verification?.status === 'VERIFIED') { points += 2; why.push('identity verified'); }
  else if (p.verification?.status === 'PROVISIONAL') { points += 1; why.push('identity provisionally verified'); }
  else why.push('identity not verified');
  if (chosen && chosen.strength >= 80) { points += 2; why.push('opportunity backed by strong evidence'); }
  else if (chosen) { points += 1; why.push('opportunity backed by partial evidence'); }
  else why.push('no clear evidence-backed opportunity');
  if (channel.status === 'RECOMMENDED') { points += 1; why.push('a contact channel exists'); if (channel.targetVerified) { points += 1; why.push('contact detail verified'); } }
  else why.push('no direct contact channel');
  if (ctx.intelligence && ctx.intelligence.confidence !== 'LOW') { points += 1; why.push('research at least medium confidence'); }
  const confidence: Confidence = points >= 5 ? 'HIGH' : points >= 3 ? 'MEDIUM' : 'LOW';

  const offer = recommendOffer(ctx, angle);
  const demo = recommendDemo(ctx, angle, confidence, channel, qualification.qualified);

  const evidence = collectEvidence(ctx);
  if (chosen) for (const f of chosen.evidence) if (!evidence.some((e) => e.text === f.text)) evidence.push(f);
  const name = displayName(p);
  const whyThis = [
    `${name}${p.category ? ` is a ${p.category.toLowerCase()}` : ''}${p.location ? ` in ${p.location}` : ''}.`,
    chosen ? `${chosen.reason}` : 'The evidence does not yet show a specific gap, so the first conversation should establish how customers find them today.',
    channel.status === 'RECOMMENDED'
      ? `A workable contact route exists (${CHANNEL_LABEL[channel.channel!]}).`
      : 'There is no direct contact route yet, so contact details must be found first.',
  ].join(' ');

  return {
    business: name,
    category: p.category,
    location: p.location,
    opportunity: opportunityLine(angle, p),
    angle,
    angleReason: chosen?.reason ?? 'No angle has enough evidence behind it (needs strength ≥ 60).',
    secondaryAngles: secondary,
    evidence,
    decisionMaker: decisionMakerFact(ctx),
    channel,
    approach: APPROACH[angle],
    offer,
    demo,
    whyThisBusiness: whyThis,
    confidence,
    confidenceReasons: why,
    websiteClaimAllowed: websiteClaimAllowed(p),
    qualification,
    generatedAt: now,
  };
}
