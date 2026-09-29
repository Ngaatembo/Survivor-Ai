/* ============================================================================
 * Proposal builder — a plain-text proposal from the recommended offer and the
 * configured prices. Never invents a number: an unpriced line is shown as
 * "to be confirmed" and the proposal is flagged MANUAL_REVIEW_REQUIRED.
 * ========================================================================== */

import { displayName } from '../lib/whatsappOutreach';
import { quoteOffer } from './pricing';
import type { MessageContext } from './messages';
import { OFFER_LABEL, type OfferType, type PriceQuote, type PricingSettings, type ProposalRow } from './types';

const money = (n: number) => `$${Number.isInteger(n) ? n : n.toFixed(2)}`;

export function buildProposalDraft(
  ctx: MessageContext,
  offerType: OfferType,
  pricing: PricingSettings,
  extraScope: string[] = [],
): Pick<ProposalRow, 'offerType' | 'quote' | 'scope' | 'body'> {
  const name = displayName(ctx.prospect);
  const brief = ctx.brief;
  const quote: PriceQuote = quoteOffer(offerType, pricing);
  const rec = brief.offer.offer === offerType ? brief.offer : undefined;

  const necessary = rec?.necessaryFeatures ?? [];
  const scope = [...necessary, ...extraScope.filter(Boolean)];

  const priceLines = quote.lines.map((l) => {
    const per = l.recurring === 'MONTHLY' ? ' per month' : l.recurring === 'YEARLY' ? ' per year' : '';
    const amount = l.amount === null ? 'to be confirmed' : `${money(l.amount)}${per}`;
    return `- ${l.label}${l.optional ? ' (optional)' : ''}: ${amount}`;
  });

  const body = [
    `Proposal for ${name}`,
    `Prepared by ${ctx.company.senderName}, ${ctx.company.company}`,
    '',
    'Why we are proposing this',
    rec ? `${rec.whyThisOffer} ${rec.problemSolved}` : brief.whyThisBusiness,
    '',
    `What is included — ${OFFER_LABEL[offerType]}`,
    ...(scope.length ? scope.map((s) => `- ${s}`) : ['- Scope to be agreed with you.']),
    '',
    'Investment',
    ...priceLines,
    quote.priceStatus === 'PRICED'
      ? `Once-off total: ${money(quote.oneOffTotal)}${quote.monthlyTotal ? `, plus ${money(quote.monthlyTotal)} per month` : ''}.`
      : 'Price to be confirmed once the scope is agreed.',
    ...(ctx.company.paymentTerms ? ['', `Payment: ${ctx.company.paymentTerms}.`] : []),
    '',
    'Timeline',
    'To be agreed once the scope is confirmed.',
    '',
    `Questions or changes? Reply here or call ${ctx.company.phone}.`,
  ].join('\n');

  return { offerType, quote, scope, body };
}
