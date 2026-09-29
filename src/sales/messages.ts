/* ============================================================================
 * Sales messaging — first-contact variants, follow-ups, discovery questions,
 * call preparation, call guide and the action plan.
 * ----------------------------------------------------------------------------
 * Rules enforced here (and checked by validateOutreach):
 *  - only facts from the stored evidence, phrased in the first person
 *    ("I couldn't find…") — never "you don't have a website" unless the brief
 *    says the claim is allowed
 *  - no unearned compliments, no guarantees, no prices in a first message
 *  - wording varies per business (deterministic, seeded by the lead id)
 * Nothing here sends anything. The salesperson reads, edits and sends.
 * ========================================================================== */

import type { Prospect } from '../types';
import { displayName } from '../lib/whatsappOutreach';
import { classifyBusiness, type LeadContext } from './intelligence';
import {
  ANGLE_LABEL,
  CHANNEL_LABEL,
  OFFER_LABEL,
  type CadenceSettings,
  type Fact,
  type MessageVariantKey,
  type SalesAngle,
  type SalesBrief,
  type SalesChannel,
} from './types';

export interface MessageContext extends LeadContext {
  brief: SalesBrief;
  /** True only when a demo for this lead really exists (never claim otherwise). */
  demoBuilt?: boolean;
}

/* -------------------------------- utilities -------------------------------- */

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function pick<T>(items: T[], seed: string): T {
  return items[hash(seed) % items.length];
}
const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const audit = (p: Prospect) => (p.verification?.websiteAudit?.status === 'AUDITED' ? p.verification.websiteAudit : undefined);

function platformOf(p: Prospect): 'Facebook' | 'Instagram' | undefined {
  if (p.socialLinks.some((u) => /facebook\.com/i.test(u))) return 'Facebook';
  if (p.socialLinks.some((u) => /instagram\.com/i.test(u))) return 'Instagram';
  return undefined;
}

function foundVia(ctx: MessageContext): string {
  const p = ctx.prospect;
  const name = displayName(p);
  const plat = platformOf(p);
  if (plat) return `I came across ${name} on ${plat}`;
  const cat = p.category ? p.category.toLowerCase() : 'local business';
  return `I came across ${name} while looking at ${cat} businesses${p.location ? ` in ${p.location}` : ''}`;
}

/** One evidence-safe observation sentence (no leading "I noticed"). */
function observation(ctx: MessageContext): string {
  const p = ctx.prospect;
  const a = audit(p);
  const name = displayName(p);
  const plat = platformOf(p) ?? 'social';
  const seed = `${p.id}:obs`;
  const cat = p.category ? p.category.toLowerCase() : 'business like yours';
  const where = p.location ? ` in ${p.location}` : '';

  switch (ctx.brief.angle) {
    case 'NO_WEBSITE':
      return pick([
        `I couldn't find a website for ${name} when I searched`,
        `when I searched for ${name} online, I didn't find a website of your own`,
      ], seed);
    case 'SOCIAL_NO_CENTRAL_SITE':
      return pick([
        `I found your ${plat} page, but I couldn't find a website that brings your services, location and contact details together in one place`,
        `your ${plat} page is easy to find, but I couldn't find a website of your own`,
      ], seed);
    case 'OUTDATED_WEBSITE': {
      const issue = a?.criticalIssues[0];
      return issue
        ? `I looked at your website and one thing stood out: ${lower(issue.replace(/\.$/, ''))}`
        : 'your current website looks like it could use an update';
    }
    case 'POOR_MOBILE':
      return 'your website doesn\'t appear to be set up for mobile screens, which is where most local customers browse';
    case 'WEAK_SEARCH_PRESENCE':
      return 'your website is missing the short page title and description that Google shows in search results';
    case 'NO_ENQUIRY_OR_BOOKING':
      return `I couldn't see a simple way to enquire, book or order directly on your website`;
    case 'NO_SERVICE_CATALOGUE':
      return `I couldn't see a clear list of what ${name} offers on your website`;
    case 'POOR_CONVERSION_PATH':
      return `I couldn't see an obvious way to contact ${name} on the first page of your website`;
    case 'ESTABLISHED_WEAK_DIGITAL':
      return `${name} shows up in a few places online, but I couldn't find one central site that pulls it together`;
    case 'IMPROVABLE_WEBSITE': {
      const opp = a?.opportunities[0];
      return opp
        ? `your website works, and I noticed one thing that could help it bring in more enquiries: ${lower(opp.replace(/\.$/, ''))}`
        : 'your website works, and there are a couple of small things that could help it bring in more enquiries';
    }
    default:
      return `I'd like to understand how customers find a ${cat}${where} like ${name} today`;
  }
}

function problemLine(ctx: MessageContext): string {
  switch (ctx.brief.angle) {
    case 'NO_WEBSITE': return 'That usually means customers who don\'t already know you have no easy way to see what you offer or get in touch.';
    case 'SOCIAL_NO_CENTRAL_SITE': return 'Social pages are great for people who follow you, but customers searching on Google often won\'t find them.';
    case 'OUTDATED_WEBSITE': return 'Small usability problems like that can quietly cost enquiries, because people leave a site that is hard to use.';
    case 'POOR_MOBILE': return 'If the site is hard to use on a phone, many visitors leave before they get in touch.';
    case 'WEAK_SEARCH_PRESENCE': return 'That can make the business look less trustworthy in search results and reduce clicks.';
    case 'NO_ENQUIRY_OR_BOOKING': return 'Visitors who are ready to act have nowhere to do it, so some of them simply move on.';
    case 'NO_SERVICE_CATALOGUE': return 'When customers can\'t quickly see what you offer, they tend to call a competitor whose offer is clearer.';
    case 'POOR_CONVERSION_PATH': return 'When the next step isn\'t obvious, interested customers often don\'t take it.';
    case 'ESTABLISHED_WEAK_DIGITAL': return 'It\'s a shame for a business that seems well known locally not to have its online presence working as hard as it could.';
    case 'IMPROVABLE_WEBSITE': return 'Small changes like that are usually quick and can make a real difference.';
    default: return 'It would help me to know before suggesting anything.';
  }
}

/* ------------------------------ first contact ------------------------------ */

export interface GeneratedMessage {
  variant: MessageVariantKey;
  label: string;
  channel: SalesChannel | undefined;
  subject?: string;
  body: string;
  warnings: string[];
}

function who(ctx: MessageContext): string {
  const c = ctx.company;
  return `My name is ${c.senderName} from ${c.company}${c.companyLine ? `, ${c.companyLine}` : ''}.`;
}

export function generateFirstContactVariants(ctx: MessageContext): GeneratedMessage[] {
  const p = ctx.prospect;
  const name = displayName(p);
  const c = ctx.company;
  const channel = ctx.brief.channel.channel;
  const obs = observation(ctx);
  const conversationFirst = ctx.brief.angle === 'CONVERSATION_FIRST';
  const seed = `${p.id}:cta`;
  const out: GeneratedMessage[] = [];

  const asQuestion = conversationFirst;
  const subject = channel === 'EMAIL' ? `A quick idea for ${name}` : undefined;
  const greeting = channel === 'EMAIL' ? `Hello ${name} team,` : `Hi ${name} 👋`;

  // A — DIRECT: short WhatsApp-style
  {
    const ask = asQuestion
      ? `Quick question — how do most customers find ${name} at the moment?`
      : pick([
          `Would it be ok if I sent you a quick idea of what this could look like for ${name}?`,
          `Would you be open to me sending a quick idea through?`,
        ], seed);
    const help = `We help Zimbabwean businesses get found and contacted online.`;
    out.push({
      variant: 'DIRECT',
      label: 'Direct (short)',
      channel,
      subject,
      body: asQuestion
        ? `${greeting} ${c.senderName} from ${c.company} here. ${foundVia(ctx)}. ${ask}`
        : `${greeting} ${c.senderName} from ${c.company} here. ${foundVia(ctx)} and ${obs}. ${help} ${ask}`,
      warnings: [],
    });
  }

  // B — CONSULTATIVE: problem and opportunity first
  {
    const cta = asQuestion
      ? `Out of curiosity, do most of your customers find you through WhatsApp, Facebook, Google or word of mouth? If it's useful I'm happy to share a few ideas — no obligation.`
      : pick([
          `If it's useful, I'd be glad to share a couple of ideas for ${name} — no obligation at all.`,
          `I'd be happy to share a few thoughts on this if you're interested — no pressure.`,
        ], seed + 'b');
    out.push({
      variant: 'CONSULTATIVE',
      label: 'Consultative',
      channel,
      subject,
      body: [
        greeting,
        '',
        who(ctx),
        '',
        asQuestion ? `${foundVia(ctx)}.` : `${foundVia(ctx)} and ${obs}.`,
        '',
        ...(asQuestion ? [] : [problemLine(ctx), '']),
        `${c.valueLine}`,
        '',
        cta,
      ].join('\n'),
      warnings: [],
    });
  }

  // C — DEMO-LED: only when a demo is worthwhile
  if (ctx.brief.demo.recommended) {
    const demoLine = ctx.demoBuilt
      ? `I've put together a quick idea of what this could look like for ${name}.`
      : `I can put together a quick example of what this could look like for ${name}.`;
    out.push({
      variant: 'DEMO_LED',
      label: 'Demo-led',
      channel,
      subject,
      body: [
        greeting,
        '',
        who(ctx),
        '',
        `${foundVia(ctx)} and ${obs}.`,
        '',
        `${c.valueLine}`,
        '',
        `${demoLine} Would you be open to me sending it through?`,
      ].join('\n'),
      warnings: [],
    });
  }

  return out.map((m) => ({ ...m, warnings: validateOutreach(m.body, ctx.brief) }));
}

/** Checks a (possibly hand-edited) message against the honesty rules. */
export function validateOutreach(body: string, brief: Pick<SalesBrief, 'websiteClaimAllowed' | 'angle'>): string[] {
  const issues: string[] = [];
  const t = body.toLowerCase();
  if (/\b(amazing|awesome|incredible|fantastic|world-class|best in|#1)\b/.test(t)) {
    issues.push('Contains a compliment or superlative with no supporting evidence — remove it or replace it with something you can point to.');
  }
  if (/\bguarantee/.test(t)) issues.push('Avoid guarantees — they cannot be backed up.');
  if (/(don'?t|do not|doesn'?t|does not|has no|have no) (have )?(a )?website|no website\b/.test(t) && !brief.websiteClaimAllowed) {
    issues.push('Claims the business has no website, but the stored evidence is not strong enough — say "I couldn\'t find" only if you checked, or ask instead.');
  }
  if (/\$\s?\d/.test(body)) issues.push('Quotes a price in a first message — better to understand their needs first.');
  if (/\b(dear sir|madam|valued customer)\b/.test(t)) issues.push('Sounds like a mass message — address the business by name.');
  if (body.length > 900) issues.push('Very long for a first message — consider trimming.');
  return issues;
}

/* --------------------------- discovery questions --------------------------- */

interface Question { id: string; text: string; base: number; boost?: (ctx: MessageContext) => number }

const QUESTION_BANK: Question[] = [
  { id: 'goal', text: 'What would you mainly like the website/system to help your business with?', base: 90 },
  { id: 'channels', text: 'Do you currently receive customers through WhatsApp, Facebook, Google or another channel?', base: 80 },
  { id: 'faq', text: 'What information do customers ask for most often?', base: 60, boost: (c) => (['RETAIL', 'TRADES', 'FOOD'].includes(classifyBusiness(c.prospect)) ? 25 : 0) },
  { id: 'transact', text: 'Would you need online enquiries, bookings, orders or payments?', base: 60, boost: (c) => (['BOOKING', 'FOOD', 'PERSONAL'].includes(classifyBusiness(c.prospect)) ? 30 : 0) },
  { id: 'domain', text: 'Do you already have a domain name?', base: 45, boost: (c) => (c.prospect.websitePresence === 'ADEQUATE' || c.prospect.websitePresence === 'WEAK_OR_OUTDATED' ? -100 : 0) },
  { id: 'update', text: 'Would you like to update prices, photos or content yourself, or have us do it?', base: 40 },
  { id: 'decider', text: 'Who else, if anyone, would be involved in deciding on this?', base: 30, boost: (c) => (c.brief.decisionMaker.kind === 'UNKNOWN' ? 45 : -100) },
  { id: 'timing', text: 'Is there a time you would like to have this in place by?', base: 35 },
];

export function pickDiscoveryQuestions(ctx: MessageContext, max = 4): { text: string; why: string }[] {
  return QUESTION_BANK
    .map((q) => ({ q, score: q.base + (q.boost ? q.boost(ctx) : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map(({ q }) => ({ text: q.text, why: q.id === 'decider' ? 'The decision-maker is still unknown.' : q.id === 'domain' ? 'Only relevant when there is no site yet.' : 'Most relevant to this business.' }));
}

/* -------------------------------- follow-ups -------------------------------- */

export type FollowUpSituation =
  | 'NO_RESPONSE_1' | 'NO_RESPONSE_2' | 'INTERESTED_BUSY' | 'ASKED_PRICE' | 'DEMO_SENT' | 'PROPOSAL_SENT' | 'POSITIVE_REPLY';

export const FOLLOW_UP_SITUATIONS: { key: FollowUpSituation; label: string }[] = [
  { key: 'NO_RESPONSE_1', label: 'No response (first follow-up)' },
  { key: 'NO_RESPONSE_2', label: 'No response (final follow-up)' },
  { key: 'POSITIVE_REPLY', label: 'They replied positively' },
  { key: 'INTERESTED_BUSY', label: 'Interested but busy' },
  { key: 'ASKED_PRICE', label: 'Asked for the price' },
  { key: 'DEMO_SENT', label: 'Demo sent' },
  { key: 'PROPOSAL_SENT', label: 'Proposal sent' },
];

export interface GeneratedFollowUp {
  situation: FollowUpSituation;
  title: string;
  message: string;
  guidance: string[];
  questions: { text: string; why: string }[];
  nextFollowUpInDays?: number;
  /** Internal reference only — never paste into a message before scope is clear. */
  internalQuote?: string;
  warnings: string[];
}

export function generateFollowUp(ctx: MessageContext, situation: FollowUpSituation, cadence: CadenceSettings, proposalSentOn?: string): GeneratedFollowUp {
  const name = displayName(ctx.prospect);
  const c = ctx.company;
  const sign = `${c.senderName}`;
  const has = ctx.demoBuilt ? 'example' : 'idea';
  let res: Omit<GeneratedFollowUp, 'warnings'>;

  switch (situation) {
    case 'NO_RESPONSE_1':
      res = {
        situation, title: 'Follow-up 1 — gentle nudge',
        message: `Hi ${name}, just checking whether you'd like me to send over the ${has} I mentioned about making it easier for customers to find and contact you online. No pressure at all — happy to leave it if now isn't the right time. ${sign}`,
        guidance: ['Reference the original observation, not a new pitch.', ctx.brief.demo.recommended ? 'Offer the demo again — it is easier to say yes to something concrete.' : 'Keep it to one easy yes/no question.'],
        questions: [], nextFollowUpInDays: cadence.followUp2Days,
      };
      break;
    case 'NO_RESPONSE_2':
      res = {
        situation, title: 'Follow-up 2 — short final message',
        message: `Hi ${name}, I don't want to keep bothering you, so this will be my last message. If getting more customers to find you online ever becomes a priority, you're welcome to message me here any time. All the best with ${name}! ${sign}`,
        guidance: [`If there is still no reply, the lead moves to DORMANT after ${cadence.dormantAfterDays} more days — do not keep contacting.`],
        questions: [], nextFollowUpInDays: cadence.dormantAfterDays,
      };
      break;
    case 'POSITIVE_REPLY':
      res = {
        situation, title: 'They replied — discover before you pitch',
        message: `Thanks for getting back to me, ${name}! So that what I show you is actually useful, could I ask a couple of quick questions?`,
        guidance: ['Ask only the most relevant questions below — not a questionnaire.', 'Listen for the real problem before proposing anything.'],
        questions: pickDiscoveryQuestions(ctx, 4), nextFollowUpInDays: 1,
      };
      break;
    case 'INTERESTED_BUSY':
      res = {
        situation, title: 'Interested but busy',
        message: `No problem at all, ${name}. When would be a convenient time? I can send it through in a message or chat for ten minutes whenever suits you.`,
        guidance: ['Get a specific day/time, then schedule the follow-up for it.'],
        questions: [], nextFollowUpInDays: 2,
      };
      break;
    case 'ASKED_PRICE':
      res = {
        situation, title: 'Asked for the price — understand first',
        message: `Happy to give you a proper figure. So that it's accurate and not a generic number, could you tell me: 1) what you mainly want the website to do for ${name}, 2) roughly what you'd like on it (pages or features, for example bookings or orders), and 3) whether you'd like to be able to update it yourself? I'll then send you an exact quote.`,
        guidance: [
          'Do NOT quote a generic price yet.',
          'Understand: what they need, number of pages/features, whether they need an admin panel, booking/order system, domain/hosting, and maintenance.',
          'Once you know the scope, use CREATE PROPOSAL to generate a quote from your pricing settings.',
        ],
        questions: [
          { text: 'What do you need it to do for the business?', why: 'Sets the scope.' },
          { text: 'How many pages or features do you have in mind?', why: 'Drives the base price.' },
          { text: 'Do you need to edit it yourself (admin panel)?', why: 'Admin panel is an add-on.' },
          { text: 'Do you need bookings or online orders?', why: 'Booking/ordering are add-ons.' },
          { text: 'Do you have a domain name and hosting?', why: 'Domain/hosting costs.' },
          { text: 'Would you want monthly maintenance and support?', why: 'Optional monthly plan.' },
        ],
        nextFollowUpInDays: 1,
        internalQuote: ctx.brief.offer.quote.priceStatus === 'PRICED'
          ? `Reference only (${OFFER_LABEL[ctx.brief.offer.offer]}): ${ctx.brief.offer.quote.oneOffTotal} once-off${ctx.brief.offer.quote.monthlyTotal ? ` + ${ctx.brief.offer.quote.monthlyTotal}/month` : ''} — confirm scope before sharing.`
          : ctx.brief.offer.quote.note,
      };
      break;
    case 'DEMO_SENT':
      res = {
        situation, title: 'Demo sent — ask for feedback',
        message: `Hi ${name}, did you get a chance to look at the example I sent? I'd love to hear what stood out and what you'd change — that helps me tailor it properly for you.`,
        guidance: ['Ask for feedback, not "have you decided?".', 'Listen for what they like — it points to the proposal scope.'],
        questions: [], nextFollowUpInDays: cadence.demoFeedbackDays,
      };
      break;
    case 'PROPOSAL_SENT':
      res = {
        situation, title: 'Proposal sent — track and chase',
        message: `Hi ${name}, following up on the proposal I sent${proposalSentOn ? ` on ${proposalSentOn}` : ''}. I'm happy to walk you through it or adjust the scope if anything doesn't fit. What questions do you have?`,
        guidance: [`Chase after ${cadence.proposalChaseDays} days, then once more after ${cadence.followUp2Days} more days.`, 'If there is still no reply, move to DORMANT rather than chasing indefinitely.'],
        questions: [], nextFollowUpInDays: cadence.proposalChaseDays,
      };
      break;
  }
  return { ...res, warnings: validateOutreach(res.message, ctx.brief) };
}

/* ------------------------------- call prep/guide ------------------------------ */

export interface Objection { objection: string; response: string }

export function buildObjections(ctx: MessageContext): Objection[] {
  const p = ctx.prospect;
  const name = displayName(p);
  const a = audit(p);
  const lighter = ctx.brief.offer.lighterAlternative;
  const priceLine = lighter
    ? `We can start smaller with a ${OFFER_LABEL[lighter].toLowerCase()} and add features when it starts paying for itself.`
    : 'We can agree a smaller first phase and add features later.';
  return [
    {
      objection: 'Your price is too high.',
      response: `I understand. Can I ask what you had in mind, or what it would need to bring in to feel worthwhile? ${priceLine}`,
    },
    {
      objection: 'Facebook is enough for us.',
      response: `Facebook works well for people who already follow you. A simple website helps the customers who search on Google and don't know you yet, and it's yours — no algorithm deciding who sees it. Many clients keep Facebook and add a small site that links to it.`,
    },
    {
      objection: 'We already have a website.',
      response: a && (a.criticalIssues.length || a.opportunities.length)
        ? `That's good to hear. I did look at it and one thing I noticed was: ${(a.criticalIssues[0] ?? a.opportunities[0]).replace(/\.$/, '')}. Would it be useful if I showed how a small change could bring in more enquiries?`
        : `That's good to hear. How are customers using it — do you get enquiries through it? If it's working well, great; if not, I can suggest a couple of quick improvements.`,
    },
    {
      objection: 'We are not ready.',
      response: `No problem. What would need to be in place for it to make sense for ${name}? I can check back in a few weeks if that suits you.`,
    },
    {
      objection: 'Send me the information.',
      response: `Happy to. So I send something relevant rather than a generic brochure, what's the main thing you'd want it to do for ${name}? I'll send a short overview${ctx.brief.demo.recommended ? ' and an example' : ''} straight after.`,
    },
    {
      objection: "We'll think about it.",
      response: `Of course. To make it easier to decide, is there anything about the idea, scope or cost that's unclear? I'll check in with you in a couple of days if that's alright.`,
    },
  ];
}

export interface CallPrep {
  businessSummary: Fact[];
  whatTheyDo: Fact;
  likelyNeed: Fact;
  knownProblems: Fact[];
  whyWeContacted: string;
  proposedSolution: string;
  questionsToAsk: { text: string; why: string }[];
  objections: Objection[];
  nextStep: string;
}

export function buildCallPrep(ctx: MessageContext): CallPrep {
  const b = ctx.brief;
  const p = ctx.prospect;
  const svc = ctx.intelligence?.apparentServices ?? [];
  const known = b.evidence.filter((e) => e.kind !== 'UNKNOWN');
  const problems = b.evidence.filter((e) => e.kind === 'VERIFIED' && e.source && /audit|search/.test(e.source));
  return {
    businessSummary: b.evidence.slice(0, 4),
    whatTheyDo: svc.length && ctx.intelligence?.confidence !== 'LOW'
      ? { kind: 'INFERENCE', text: `${p.category || 'Business'}: services appear to include ${svc.slice(0, 5).join(', ')}.` }
      : { kind: 'UNKNOWN', text: `Ask what ${displayName(p)} mainly does and who its customers are.` },
    likelyNeed: { kind: 'INFERENCE', text: `${ANGLE_LABEL[b.angle]} → ${OFFER_LABEL[b.offer.offer].toLowerCase()}. ${b.offer.problemSolved}` },
    knownProblems: problems.length ? problems : known.filter((e) => e.kind === 'INFERENCE').slice(0, 2),
    whyWeContacted: b.whyThisBusiness,
    proposedSolution: `${OFFER_LABEL[b.offer.offer]}: ${b.offer.whyThisOffer} Start with: ${b.offer.necessaryFeatures.join('; ')}. Optional: ${b.offer.optionalFeatures.join('; ')}.`,
    questionsToAsk: pickDiscoveryQuestions(ctx, 4),
    objections: buildObjections(ctx),
    nextStep: b.demo.recommended
      ? 'Agree to send a short demo, and book a time to get feedback on it.'
      : 'Agree a follow-up conversation or short meeting to understand their needs, then send a scoped proposal.',
  };
}

export interface CallStep { step: number; title: string; goal: string; talkingPoints: string[] }

/** A call GUIDE — talking points to adapt, never a script to read out. */
export function buildCallGuide(ctx: MessageContext): CallStep[] {
  const name = displayName(ctx.prospect);
  const c = ctx.company;
  const obs = observation(ctx);
  return [
    { step: 1, title: 'Greeting', goal: 'Sound friendly and unhurried.', talkingPoints: ['Greet warmly; use their name if you know it.'] },
    { step: 2, title: 'Confirm the right person', goal: 'Reach whoever handles marketing or decisions.', talkingPoints: [`"Am I speaking with someone who looks after ${name}'s marketing or the business itself?"`, ctx.brief.decisionMaker.kind === 'UNKNOWN' ? 'Note the name of the decision-maker — it is unknown so far.' : ctx.brief.decisionMaker.text] },
    { step: 3, title: 'Why you are calling', goal: 'Be upfront and brief.', talkingPoints: [`Introduce yourself: ${c.senderName} from ${c.company}.`, 'Say you will only take two minutes and ask if that is ok.'] },
    { step: 4, title: 'Specific observation', goal: 'Show you looked at their business.', talkingPoints: [`${foundVia(ctx)}${ctx.brief.angle === 'CONVERSATION_FIRST' ? '.' : ` and ${obs}.`}`] },
    { step: 5, title: 'Their current situation', goal: 'Get them talking.', talkingPoints: ['How do most customers find you today?', 'What works well, and what is frustrating?'] },
    { step: 6, title: 'Listen', goal: 'Let them finish; take notes.', talkingPoints: ['Do not pitch yet. Repeat back what you heard.'] },
    { step: 7, title: 'Identify the problem', goal: 'Agree on one problem worth solving.', talkingPoints: [`Likely area: ${ANGLE_LABEL[ctx.brief.angle].toLowerCase()} — confirm it is real for them.`, ...pickDiscoveryQuestions(ctx, 2).map((q) => q.text)] },
    { step: 8, title: 'Relevant solution', goal: 'Connect one solution to their problem.', talkingPoints: [ctx.brief.offer.whyThisOffer, `Solves: ${ctx.brief.offer.problemSolved}`] },
    { step: 9, title: 'Next step', goal: 'Propose a small, low-pressure step.', talkingPoints: [ctx.brief.demo.recommended ? 'Offer to send a short example for their feedback.' : 'Offer a short meeting or a scoped proposal.'] },
    { step: 10, title: 'Schedule follow-up', goal: 'Leave with a date.', talkingPoints: ['Agree exactly when you will speak/send again, and record it in the lead.'] },
  ];
}

/* -------------------------------- action plan -------------------------------- */

export interface PlanStep { when: string; action: string; condition?: string }

export function buildActionPlan(ctx: MessageContext, cadence: CadenceSettings): PlanStep[] {
  const ch = ctx.brief.channel.channel ? CHANNEL_LABEL[ctx.brief.channel.channel] : 'the best available channel';
  const total1 = cadence.followUp1Days;
  const total2 = cadence.followUp1Days + cadence.followUp2Days;
  if (ctx.brief.channel.status === 'NO_DIRECT_CHANNEL') {
    return [{ when: 'Now', action: 'Find decision-maker/contact information manually, then update the lead card.' }];
  }
  return [
    { when: 'Day 0', action: `Send the personalised first message via ${ch}.` },
    { when: 'If replied', action: 'Ask the discovery questions before proposing anything.', condition: 'REPLIED' },
    { when: `Day ${total1}`, action: 'Follow-up 1: reference the original observation and offer the example/idea.', condition: 'No response' },
    { when: `Day ${total2}`, action: 'Follow-up 2: one short, final message.', condition: 'Still no response' },
    { when: `Day ${total2 + cadence.dormantAfterDays}`, action: 'Move to DORMANT. Do not keep contacting.', condition: 'Still no response' },
  ];
}
