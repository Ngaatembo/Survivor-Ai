/* ============================================================================
 * One-tap WhatsApp outreach.
 * ----------------------------------------------------------------------------
 * Builds the message a human sends from their OWN WhatsApp, plus a wa.me link
 * that opens WhatsApp with the message already typed. Survivor never sends
 * anything itself: the operator reads, edits if needed, and presses send.
 *
 * Every claim in the message comes from stored evidence (Facebook-only
 * presence, the business's own name/town) and the price comes from the real
 * Zimbabwe market table (zimWebsitePricing.ts). No invented facts.
 * ========================================================================== */

import type { Prospect } from '../types';
import { BUSINESS } from '../config/business';
import { marketPriceForProspect, type TierPrice } from './zimWebsitePricing';

export interface PhoneInfo {
  /** Digits with country code, for wa.me / tel: (e.g. 263772862688). */
  international: string;
  /** Human format (e.g. +263 77 286 2688). */
  display: string;
  /** Zimbabwe mobile (071/073/077/078) — reachable on WhatsApp. Landlines are call-only. */
  isMobile: boolean;
}

/** Normalize a stored contact into a dialable Zimbabwe number, or null. */
export function parseZimPhone(raw: string | undefined | null): PhoneInfo | null {
  if (!raw) return null;
  // wa.me links sometimes carry the number: wa.me/263771234567
  const fromLink = raw.match(/wa\.me\/(\d{9,13})/i)?.[1] ?? raw.match(/phone=(\d{9,13})/i)?.[1];
  let digits = (fromLink ?? raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('00263')) digits = digits.slice(2);
  if (digits.startsWith('2630')) digits = '263' + digits.slice(4);
  if (digits.startsWith('0')) digits = '263' + digits.slice(1);
  if (/^7[1378]\d{7}$/.test(digits)) digits = '263' + digits;
  if (!digits.startsWith('263')) return null;
  const national = digits.slice(3);
  const isMobile = /^7[1378]\d{7}$/.test(national);
  const isLandline = /^[2-6]\d{6,8}$/.test(national) || /^8[68]\d{6,8}$/.test(national);
  if (!isMobile && !isLandline) return null;
  const display = isMobile
    ? `+263 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`
    : `+263 ${national}`;
  return { international: digits, display, isMobile };
}

/** The best phone number on record for this prospect. */
export function prospectPhone(p: Prospect): PhoneInfo | null {
  return (
    parseZimPhone(p.verification?.verifiedContactValue) ??
    parseZimPhone(p.contactValue) ??
    (p.verification?.alternateContacts ?? []).map(parseZimPhone).find(Boolean) ??
    null
  );
}

/** Facebook / Instagram / WhatsApp page to look at before messaging. */
export function prospectPageUrl(p: Prospect): string | undefined {
  const social = p.socialLinks.find((u) => /facebook\.com|instagram\.com|wa\.me|whatsapp\.com/i.test(u));
  if (social) return social;
  if (p.contactValue && /^https?:\/\//i.test(p.contactValue)) return p.contactValue;
  return p.sources.find((s) => s.url)?.url;
}

export function prospectPrice(p: Prospect): TierPrice {
  return marketPriceForProspect(p);
}

function presenceLine(p: Prospect): string {
  const name = displayName(p);
  const fb = p.socialLinks.some((u) => /facebook\.com/i.test(u)) || /facebook/i.test(p.evidenceNotes);
  const ig = p.socialLinks.some((u) => /instagram\.com/i.test(u)) || /instagram/i.test(p.evidenceNotes);
  const wa = /whatsapp business link/i.test(p.evidenceNotes);
  switch (p.websitePresence) {
    case 'SOCIAL_ONLY':
      if (fb) return `I came across ${name} on Facebook, but I couldn't find a website for you — so people searching on Google may not find you.`;
      if (ig) return `I came across ${name} on Instagram, but I couldn't find a website for you — so people searching on Google may not find you.`;
      if (wa) return `I came across ${name}'s WhatsApp Business link, but I couldn't find a website for you — so people searching on Google may not find you.`;
      return `I came across ${name} online, but I couldn't find a website for you.`;
    case 'WEAK_OR_OUTDATED':
      return `I came across ${name} online and had a look at your current website — I think it could be bringing you a lot more customers.`;
    default:
      return `I came across ${name} online, but I couldn't find a website for you.`;
  }
}

/** Clean display name ("SupaFix Workshop"), without "on Facebook" style suffixes. */
export function displayName(p: Prospect): string {
  return (p.verification?.verifiedBusinessName || p.businessName).replace(/\s+(on|via)\s+(facebook|instagram|whatsapp|tiktok)\s*$/i, '').trim();
}

export function firstMessage(p: Prospect): string {
  const price = prospectPrice(p);
  const proof = BUSINESS.proofSites.length ? ` Some of our recent work: ${BUSINESS.proofSites.join(' and ')}.` : '';
  return [
    `Hi ${displayName(p)} 👋`,
    '',
    `My name is ${BUSINESS.senderName} from ${BUSINESS.company}, ${BUSINESS.companyLine}.`,
    '',
    presenceLine(p),
    '',
    `We build mobile-friendly websites for Zimbabwean businesses — your services, photos, location and a WhatsApp button so customers can reach you in one tap.${proof}`,
    '',
    `For ${displayName(p)}, a ${price.label.toLowerCase()} would be $${price.quote} once-off (most agencies here charge $${price.marketMin}–$${price.marketMax}).`,
    '',
    `Can I make you a free preview first, so you can see it before deciding anything?`,
  ].join('\n');
}

export function followUpMessage(p: Prospect): string {
  return [
    `Hi ${displayName(p)}, ${BUSINESS.senderName} from ${BUSINESS.company} again 🙂`,
    '',
    `Just following up on my message about a website for your business. I'm happy to put together a free preview this week — no commitment.`,
    '',
    `Should I go ahead?`,
  ].join('\n');
}

export function priceDetailsMessage(p: Prospect): string {
  const price = prospectPrice(p);
  return [
    `Thank you for getting back to me! Here are the details:`,
    '',
    `✅ ${price.label}: ${price.scope}`,
    `💵 $${price.quote} once-off (50% to start, 50% when you're happy with it)`,
    `🛠 Optional care plan: $${price.monthlyCare}/month for updates, hosting and support`,
    `⏱ Ready in about 5–7 days`,
    '',
    `You can see our work at ${BUSINESS.website}${BUSINESS.proofSites.length ? `, ${BUSINESS.proofSites.join(', ')}` : ''}.`,
    '',
    `Would you like me to start with the free preview?`,
  ].join('\n');
}

/** wa.me link that opens WhatsApp with the text already typed. */
export function whatsappLink(phone: PhoneInfo, text: string): string {
  return `https://wa.me/${phone.international}?text=${encodeURIComponent(text)}`;
}

export function callLink(phone: PhoneInfo): string {
  return `tel:+${phone.international}`;
}
