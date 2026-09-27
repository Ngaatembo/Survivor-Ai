/* ============================================================================
 * Approval queue — the bot prepares, a person approves and presses send.
 * ----------------------------------------------------------------------------
 * Each cycle, Survivor puts its best prepared outreach into the human
 * approval queue by itself (first WhatsApp message to a verified business,
 * or sending a drafted offer), with the exact text attached. The owner
 * approves, taps through to WhatsApp to send it from their own phone, then
 * marks it sent. Survivor never sends anything itself.
 *
 * Approval ids match the server-side gate in worker/src/index.ts
 * (hasHumanApproval): `outreach:{prospectId}` for CONTACT_PROSPECT and
 * `offer:{offerId}` for SEND_OFFER — the CRM refuses to record CONTACTED or
 * PROPOSAL_SENT without a matching approval.
 * ========================================================================== */

import type { Offer, OutreachMessageSet, Prospect, RecommendedAction } from '../types';

export const APPROVALS_KV_KEY = 'human_action_approvals';
export const MAX_STORED_APPROVALS = 200;

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'EXECUTED';

export interface QueuedApproval {
  id: string;
  actionId: string;
  actionKind: string;
  title: string;
  prospectId?: string;
  prospectName?: string;
  opportunityId?: string;
  offerId?: string;
  status: ApprovalStatus;
  createdAt: number;
  reviewedAt?: number;
  executedAt?: number;
  note?: string;
  /** AUTO = queued by the cycle; HUMAN = requested from the dashboard. */
  source?: 'AUTO' | 'HUMAN';
  channel?: string;
  contact?: string;
  /** The exact text to send, so approving means approving these words. */
  message?: string;
  whatsappUrl?: string;
}

/** The approval id the server-side CRM gate looks for. */
export function approvalActionId(kind: string, prospectId?: string, offerId?: string, fallback?: string): string {
  if ((kind === 'CONTACT_PROSPECT' || kind === 'FOLLOW_UP_PROSPECT') && prospectId) return `outreach:${prospectId}`;
  if (kind === 'SEND_OFFER' && offerId) return `offer:${offerId}`;
  return fallback ?? `${kind}:${prospectId ?? ''}`;
}

/** wa.me link that opens WhatsApp on the owner's phone with the text filled
 *  in. Zimbabwe numbers written locally (07…) are converted to 2637…. */
export function whatsappUrl(phone: string | undefined, text: string): string | undefined {
  if (!phone) return undefined;
  let digits = phone.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `263${digits.slice(1)}`;
  if (digits.length < 9 || digits.length > 15) return undefined;
  return `https://wa.me/${digits}?text=${encodeURIComponent(text)}`;
}

/** The CRM only lets a prospect be marked CONTACTED with verified identity
 *  and a verified public contact, so only those are worth queueing. */
export function contactReady(p: Prospect): boolean {
  const v = p.verification;
  return Boolean(v && (v.status === 'VERIFIED' || v.status === 'PROVISIONAL') && (v.verifiedContactValue || v.verifiedEmail));
}

function phoneLike(value?: string): boolean {
  return Boolean(value && value.replace(/\D/g, '').length >= 9 && !/^https?:/i.test(value));
}

let counter = 0;
function newId(now: number): string {
  counter = (counter + 1) % 1_000_000;
  return `approval_${now.toString(36)}_${counter.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Add AUTO approvals for the top prepared actions that aren't queued yet.
 * Any existing record for the same action — pending, approved, sent or
 * rejected — blocks a new one: a rejection means the owner said no.
 */
export function queueApprovals(
  existing: QueuedApproval[],
  input: {
    actions: RecommendedAction[];
    prospects: Prospect[];
    outreach: OutreachMessageSet[];
    offers: Offer[];
    now?: number;
    max?: number;
  },
): { approvals: QueuedApproval[]; added: QueuedApproval[] } {
  const now = input.now ?? Date.now();
  const max = input.max ?? 5;
  const known = new Set(existing.map((a) => a.actionId));
  const added: QueuedApproval[] = [];

  for (const action of [...input.actions].sort((a, b) => a.rank - b.rank)) {
    if (added.length >= max) break;
    const p = action.prospectId ? input.prospects.find((x) => x.id === action.prospectId) : undefined;
    if (!p || p.priority === 'DO_NOT_CONTACT' || !contactReady(p)) continue;
    const contact = p.verification?.verifiedContactValue ?? p.contactValue;
    const channel = p.verification?.verifiedContactChannel ?? p.contactChannel;

    if (action.kind === 'CONTACT_PROSPECT') {
      if (p.status !== 'DISCOVERED' && p.status !== 'QUALIFIED') continue;
      const msg = input.outreach.find((m) => m.prospectId === p.id);
      if (!msg?.whatsapp) continue;
      const actionId = approvalActionId('CONTACT_PROSPECT', p.id);
      if (known.has(actionId)) continue;
      known.add(actionId);
      added.push({
        id: newId(now),
        actionId,
        actionKind: 'CONTACT_PROSPECT',
        title: `Message ${p.businessName}`,
        prospectId: p.id,
        prospectName: p.businessName,
        opportunityId: p.opportunityId,
        status: 'PENDING',
        createdAt: now,
        source: 'AUTO',
        channel,
        contact,
        message: msg.whatsapp,
        whatsappUrl: phoneLike(contact) ? whatsappUrl(contact, msg.whatsapp) : undefined,
      });
    } else if (action.kind === 'SEND_OFFER') {
      // Offers go to businesses we've already spoken to; the first message
      // is always the approved WhatsApp intro above.
      if (!['CONTACTED', 'REPLIED', 'INTERESTED', 'NEGOTIATING', 'FOLLOW_UP'].includes(p.status)) continue;
      const offer = input.offers.find((o) => o.prospectId === p.id && o.status === 'DRAFT');
      if (!offer) continue;
      const actionId = approvalActionId('SEND_OFFER', p.id, offer.id);
      if (known.has(actionId)) continue;
      known.add(actionId);
      const message =
        `Hi ${p.businessName}, following up on our chat — here is the proposal: ${offer.deliverables.slice(0, 3).join('; ')}. ` +
        `Price: $${offer.price}, ready in ${offer.timelineDaysMin}-${offer.timelineDaysMax} days. Happy to adjust anything — just reply here.`;
      added.push({
        id: newId(now),
        actionId,
        actionKind: 'SEND_OFFER',
        title: `Send the $${offer.price} offer to ${p.businessName}`,
        prospectId: p.id,
        prospectName: p.businessName,
        opportunityId: p.opportunityId,
        offerId: offer.id,
        status: 'PENDING',
        createdAt: now,
        source: 'AUTO',
        channel,
        contact,
        message,
        whatsappUrl: phoneLike(contact) ? whatsappUrl(contact, message) : undefined,
      });
    }
  }

  const approvals = [...existing, ...added].slice(-MAX_STORED_APPROVALS);
  return { approvals, added };
}
