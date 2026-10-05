/* ============================================================================
 * WebAuraServiceStrategy — sell a website to a local business that lacks one.
 * ----------------------------------------------------------------------------
 * One strategy among (eventually) many. It reuses everything WebAura already
 * built — discovered + verified prospects, drafted offers, Zimbabwe market
 * pricing, wa.me links — and reads it from storage only. Running it costs $0
 * and contacts no one: it produces opportunities and drafts the message a
 * human sends from their own WhatsApp.
 * ========================================================================== */

import type { Offer, Prospect } from '../../types';
import { BUSINESS } from '../../config/business';
import { prospectPhone, prospectPrice, whatsappLink } from '../../lib/whatsappOutreach';
import type { ActionProposal, Opportunity, OpportunityCandidate, Strategy, SurvivorAction } from '../types';

export interface WebAuraSource {
  prospect: Prospect;
  offer?: Offer;
}

/** "Harare, Zimbabwe - Garwe Restaurant on Facebook" → "Garwe Restaurant". */
export function cleanBusinessName(p: Prospect): string {
  let name = (p.verification?.verifiedBusinessName || p.businessName).trim();
  name = name.replace(/\s+(on|via)\s+(facebook|instagram|whatsapp|tiktok)\s*$/i, '');
  // Leading "Town, Country - " that search titles often carry.
  name = name.replace(/^[A-Za-z .'-]+,\s*Zimbabwe\s*[-–|:]\s*/i, '');
  name = name.replace(/\s*[-–|]\s*(Home|Facebook|Instagram)\s*$/i, '');
  return name.trim() || p.businessName.trim();
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** First message: no price (price is discussed only once they reply). */
export function firstContactMessage(p: Prospect): string {
  const name = cleanBusinessName(p);
  const presence = p.websitePresence === 'WEAK_OR_OUTDATED'
    ? `I had a look at ${name}'s current website and I think it could be bringing you more customers.`
    : `I came across ${name} online but couldn't find a website for you, so people searching on Google may not find you.`;
  const proof = BUSINESS.proofSites.length ? ` Recent work: ${BUSINESS.proofSites.join(', ')}.` : '';
  return [
    `Hi ${name} 👋`,
    '',
    `I'm ${BUSINESS.senderName} from ${BUSINESS.company}, ${BUSINESS.companyLine}.`,
    '',
    presence,
    '',
    `We build simple mobile-friendly sites for local businesses — your services, photos, location and a WhatsApp button.${proof}`,
    '',
    `Can I make you a free preview first, so you can see it before deciding anything?`,
  ].join('\n');
}

export function followUpContactMessage(p: Prospect): string {
  const name = cleanBusinessName(p);
  return [
    `Hi ${name}, ${BUSINESS.senderName} from ${BUSINESS.company} again 🙂`,
    '',
    `Just following up on the free website preview. Happy to put it together this week, no commitment.`,
    '',
    `Should I go ahead?`,
  ].join('\n');
}

export const webAuraServiceStrategy: Strategy<WebAuraSource> = {
  id: 'webaura-service',
  name: 'WebAura website service',
  customer: 'Local businesses in Zimbabwe with no or a weak website and a reachable WhatsApp number',
  problem: 'Customers searching online cannot find them or order from them',
  offer: 'A mobile-friendly website with WhatsApp ordering; free preview first',
  costModel: '$0 cash to test: a human sends a WhatsApp message and builds a free preview. No paid API calls.',
  successCriterion: 'A provider-verified customer payment (Finivex) for the website',

  candidates(sources) {
    const out: OpportunityCandidate[] = [];
    for (const { prospect: p, offer } of sources) {
      if (p.dataSource !== 'LIVE') continue;
      const phone = prospectPhone(p);
      const verification = p.verification?.status ?? 'UNVERIFIED';
      const price = prospectPrice(p);
      const value = offer && offer.price > 0 ? offer.price : price.quote;
      const baseClose = clamp(p.score?.probabilityOfClose ?? 0.05, 0.01, 0.5);
      // Reachability: identity/contact confidence discounts the close rate.
      const reach = verification === 'VERIFIED' ? 1 : verification === 'PROVISIONAL' ? 0.6 : 0.3;
      const prior = Math.round(baseClose * reach * 1000) / 1000;

      let disqualifiedBecause: string | null = null;
      if (p.priority === 'DO_NOT_CONTACT') disqualifiedBecause = 'marked DO_NOT_CONTACT';
      else if (['WON', 'LOST', 'NOT_INTERESTED'].includes(p.status)) disqualifiedBecause = `prospect already ${p.status}`;
      else if (verification === 'CONFLICT') disqualifiedBecause = 'conflicting contact details — verify identity first';
      else if (!phone || !phone.isMobile) disqualifiedBecause = 'no WhatsApp-reachable mobile number on record';
      else if (p.websitePresence === 'ADEQUATE') disqualifiedBecause = 'already has an adequate website';

      const name = cleanBusinessName(p);
      out.push({
        sourceRef: p.id,
        title: `Website for ${name}`,
        targetCustomer: `${name}${p.location ? ` (${p.location})` : ''}`,
        problem: p.websitePresence === 'WEAK_OR_OUTDATED' ? 'Weak or outdated website' : 'No website found; only social/directory presence',
        offer: offer
          ? `$${value} — ${offer.deliverables.slice(0, 3).join(', ') || 'website'} (${offer.timelineDaysMin}–${offer.timelineDaysMax} days)`
          : `$${value} — ${price.label}: ${price.scope}`,
        hypothesis: `${name} will accept a free preview and pay about $${value} for the website.`,
        successCriterion: `Finivex-verified payment from ${name}`,
        estimatedValue: value,
        estimatedCost: 0,
        priorProbability: prior,
        evidence: {
          prospectId: p.id,
          verification,
          verificationConfidence: p.verification?.confidence ?? null,
          phone: phone?.display ?? null,
          websitePresence: p.websitePresence,
          leadScore: p.score?.total ?? null,
          probabilityOfClose: p.score?.probabilityOfClose ?? null,
          offerId: offer?.id ?? null,
          priceSource: offer ? 'drafted offer' : 'Zimbabwe market price table',
        },
        disqualifiedBecause,
      });
    }
    return out;
  },

  nextAction(opp: Opportunity, source: WebAuraSource | undefined, last: SurvivorAction | null): ActionProposal | null {
    if (!source) return null;
    const p = source.prospect;
    const phone = prospectPhone(p);
    if (!phone) return null;

    const contact = (kind: 'CONTACT_PROSPECT' | 'FOLLOW_UP', text: string, pReply: number): ActionProposal => ({
      kind,
      title: kind === 'CONTACT_PROSPECT' ? `WhatsApp ${cleanBusinessName(p)}` : `Follow up with ${cleanBusinessName(p)}`,
      why: `${opp.problem}. Expected value $${(opp.estimatedValue * opp.probability).toFixed(2)} (value $${opp.estimatedValue} × p ${opp.probability.toFixed(3)}) at $0 cash cost.`,
      instructions: [
        `1. Approve, then open the WhatsApp link (or dial ${phone.display}) from your own phone.`,
        '2. Read the message, edit if needed, and press send yourself. Survivor never sends anything.',
        '3. Mark the action COMPLETE once sent.',
        '4. When they answer (or after 3 days with no answer), REPORT the result.',
      ].join('\n'),
      payload: { channel: 'WHATSAPP', phone: phone.display, message: text, whatsappUrl: whatsappLink(phone, text) },
      predictedOutcome: `INTERESTED with p≈${pReply.toFixed(2)}`,
      predictedProbability: pReply,
      cost: 0,
    });

    if (!last) return contact('CONTACT_PROSPECT', firstContactMessage(p), clamp(opp.probability * 3, 0.05, 0.6));
    if (last.result === 'NO_RESPONSE' && last.kind === 'CONTACT_PROSPECT') {
      return contact('FOLLOW_UP', followUpContactMessage(p), clamp(opp.probability * 1.5, 0.03, 0.4));
    }
    if (last.result && ['INTERESTED', 'NEGOTIATING', 'TRIAL'].includes(last.result)) {
      return {
        kind: 'REQUEST_PAYMENT',
        title: `Request payment from ${cleanBusinessName(p)}`,
        why: `They responded ${last.result}. The success criterion is a provider-verified payment, so the next step is a real payment request.`,
        instructions: [
          '1. Agree scope and amount with the customer (a 50% deposit is fine).',
          '2. Create a payment request (POST /payments/requests), approve it, then create the Finivex link (POST /payments/finivex/create-approved-link).',
          '3. Send the link to the customer yourself.',
          '4. When they say they have paid, REPORT result PAID with the Finivex transactionId, amount and currency.',
          '   Survivor asks Finivex directly; only a provider-confirmed payment becomes revenue.',
        ].join('\n'),
        payload: {
          suggestedAmount: opp.estimatedValue,
          suggestedDeposit: Math.round(opp.estimatedValue / 2),
          currency: 'USD',
          description: opp.title,
          prospectId: p.id,
          phone: phone.display,
        },
        predictedOutcome: `PAID with p≈${clamp(opp.probability * 4, 0.1, 0.8).toFixed(2)}`,
        predictedProbability: clamp(opp.probability * 4, 0.1, 0.8),
        cost: 0,
      };
    }
    return null;
  },
};
