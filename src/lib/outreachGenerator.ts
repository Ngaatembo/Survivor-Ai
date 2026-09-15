/* ============================================================================
 * SURVIVE AI — AI Outreach Assistant (build-spec §9)
 * ----------------------------------------------------------------------------
 * Generates every message variant for a qualified prospect, personalized
 * ONLY from the prospect's own verified fields (business name, category,
 * location, observed website presence) and the linked business model's
 * offer/price/objection-handling. Never invents facts about the business,
 * never fabricates a claim the business hasn't demonstrated, and everything
 * produced here is prepared for human approval/execution — nothing here
 * sends anything automatically (spec §20).
 * ========================================================================== */

import type { BusinessModel, OutreachMessageSet, Prospect, ProspectIntelligence } from '../types';
import { uid } from './format';

function presenceLine(p: Prospect): string {
  switch (p.websitePresence) {
    case 'NONE_FOUND':
      return "I couldn't find a website for you";
    case 'SOCIAL_ONLY':
      return 'I noticed your main online presence is a social page rather than your own website';
    case 'WEAK_OR_OUTDATED':
      return 'I noticed your current website looks like it could use an update';
    default:
      return 'I came across your business';
  }
}

/** Phase 6 — when a genuine, AI-synthesized (not raw-digest) intelligence
 *  report exists with at least MEDIUM confidence, use its specific
 *  angle/problem evidence to personalize the opener instead of the generic
 *  website-presence line. Never used at LOW confidence or from an
 *  unsynthesized digest — those aren't reliable enough to put in front of
 *  a real customer as if they were researched insight. */
function personalizedOpener(prospect: Prospect, intelligence: ProspectIntelligence | undefined): string {
  const generic = presenceLine(prospect);
  if (!intelligence || intelligence.generator !== 'llm' || intelligence.confidence === 'LOW') return generic;
  return intelligence.specificProblemEvidence?.trim() || generic;
}

export function generateOutreachMessages(
  prospect: Prospect,
  model: BusinessModel | undefined,
  intelligence?: ProspectIntelligence,
  now: number = Date.now(),
): OutreachMessageSet {
  const name = prospect.businessName;
  const price = model?.suggestedPrice ?? 25;
  const offer = model?.offer ?? 'a professional, mobile-friendly website';
  const timeline = model?.timeToFirstSaleDaysEstimate ?? 14;
  const opener = personalizedOpener(prospect, intelligence);

  const whatsapp = `Hi ${name} 👋 ${opener} while researching businesses in ${prospect.location}. I build ${offer.toLowerCase()} for local businesses, starting at $${price}, usually delivered within ~${timeline} days. Would you be open to a quick chat about what that could look like for you?`;

  const sms = `Hi, this is regarding ${name}. ${opener}. I offer ${offer.toLowerCase()} from $${price}. Reply if you'd like details — no obligation.`;

  const email = {
    subject: `Quick idea for ${name}`,
    body: `Hi,\n\n${opener} while researching businesses in ${prospect.location}.\n\nI help local businesses like yours with ${offer.toLowerCase()}. Based on similar projects, a first engagement typically starts around $${price} and takes about ${timeline} days to deliver.\n\nWould you be open to a short conversation this week to see if it's a fit? No pressure either way.\n\nBest,\nSURVIVE AI operator`,
  };

  const shortVersion = `Hi ${name} — ${opener.toLowerCase()}. I build ${offer.toLowerCase()} from $${price}. Interested?`;

  const professionalVersion = `Good day, my name is [operator name] and I work with local businesses in ${prospect.location} on ${offer.toLowerCase()}. ${opener}, and wanted to reach out directly in case a professional web presence would help ${name} reach more customers. Engagements typically start at $${price} with delivery in ~${timeline} days. I'd welcome the chance to discuss further at your convenience.`;

  const followUp1 = `Hi again — just following up on my note about ${name}'s online presence. Happy to answer any questions, and there's no pressure either way.`;
  const followUp2 = `Last check-in from me on this — if now isn't the right time for ${name}, that's completely fine. Feel free to reach out whenever it becomes a priority.`;

  const objectionResponses = model?.objectionHandling?.length
    ? model.objectionHandling
    : [
        {
          objection: '"That\'s more than I want to spend."',
          response: `Happy to scope a smaller first version at a lower price if that helps — the goal is a good first result, not the biggest possible invoice.`,
        },
        {
          objection: '"I don\'t know you."',
          response: 'Understandable — I can share examples of similar work, or start with a small first deliverable so there\'s minimal risk on your side.',
        },
        {
          objection: '"I need to think about it."',
          response: 'Of course — I\'ll follow up in a few days. No pressure, and feel free to reach out sooner if anything comes up.',
        },
      ];

  const priceExplanation = model?.priceRationale
    ? `The $${price} quote reflects: ${model.priceRationale}`
    : `The $${price} starting quote is based on a first, minimal-scope engagement — the final price depends on exactly what ${name} needs.`;

  const callScript = [
    `Opening: "Hi, is this ${name}? My name is [operator name] — I reached out about ${offer.toLowerCase()} for local businesses in ${prospect.location}."`,
    `Confirm interest: "Do you have 2 minutes, or is there a better time to call back?"`,
    `Diagnose: "Can you tell me a bit about how customers currently find you online?"`,
    `Present: "Based on what you've described, here's what I'd suggest…" (tailor to their actual answer — never assume)`,
    `Price: priceExplanation above — quote $${price} as a starting point, adjust to the real scope discussed.`,
    `Close: "Would you like me to put together a short proposal based on this conversation?"`,
  ];

  const meetingAgenda = [
    `1. Understand ${name}'s current customers and how they find the business today.`,
    `2. Identify the single biggest gap in their current online presence.`,
    `3. Walk through the proposed offer (${offer.toLowerCase()}) and how it addresses that gap.`,
    `4. Discuss price ($${price} starting point) and timeline (~${timeline} days).`,
    `5. Agree on next steps — proposal, deposit, or a follow-up date.`,
  ];

  const proposalOutline = [
    `Business: ${name} (${prospect.location})`,
    `Problem observed: ${opener}.`,
    `Proposed offer: ${offer}.`,
    `Price: $${price} starting quote — ${model?.priceRationale ?? 'final price depends on agreed scope'}.`,
    `Timeline: ~${timeline} days from kickoff.`,
    `Next step: confirm scope and schedule kickoff.`,
  ];

  return {
    id: uid('outreach'),
    prospectId: prospect.id,
    opportunityId: prospect.opportunityId,
    businessModelId: model?.id,
    whatsapp,
    sms,
    email,
    shortVersion,
    professionalVersion,
    followUp1,
    followUp2,
    objectionResponses,
    priceExplanation,
    callScript,
    meetingAgenda,
    proposalOutline,
    generator: 'local-rule-engine',
    generatedAt: now,
    updatedAt: now,
  };
}
