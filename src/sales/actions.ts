/* ============================================================================
 * Daily sales cockpit + pipeline counts.
 * ----------------------------------------------------------------------------
 * Answers: who should I contact today, why, and what is the next action?
 * Pure functions over data the Worker loads from D1.
 * ========================================================================== */

import {
  ACTIVE_STAGES,
  AWAITING_REPLY_STAGES,
  FUNNEL_ORDER,
  type FollowUpRow,
  type MeetingRow,
  type ProposalRow,
  type SalesAction,
  type SalesLeadRow,
  type SalesStage,
} from './types';

const DAY = 24 * 60 * 60 * 1000;

export interface LeadBundle {
  prospectId: string;
  businessName: string;
  score: number;
  lead: SalesLeadRow;
  followUps: FollowUpRow[];
  meetings: MeetingRow[];
  proposals: ProposalRow[];
}

export interface SalesToday {
  actions: SalesAction[];
  overdueFollowUps: SalesAction[];
  manualResearch: SalesAction[];
  awaitingReply: { prospectId: string; businessName: string; stage: SalesStage; daysWaiting: number; nextDueAt?: number }[];
  upcomingMeetings: { prospectId: string; businessName: string; scheduledAt: number; kind: string }[];
  proposalsAwaiting: { prospectId: string; businessName: string; sentAt?: number; daysWaiting: number; total: number }[];
}

const startOfDay = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const daysSince = (t: number | undefined, now: number) => (t ? Math.max(0, Math.floor((now - t) / DAY)) : 0);

export function computeToday(bundles: LeadBundle[], now = Date.now()): SalesToday {
  const actions: SalesAction[] = [];
  const manualResearch: SalesAction[] = [];
  const awaitingReply: SalesToday['awaitingReply'] = [];
  const upcomingMeetings: SalesToday['upcomingMeetings'] = [];
  const proposalsAwaiting: SalesToday['proposalsAwaiting'] = [];
  const todayStart = startOfDay(now);

  for (const b of bundles) {
    const { lead } = b;
    const brief = lead.briefJson;
    const base = { prospectId: b.prospectId, businessName: b.businessName, stage: lead.stage };
    if (lead.paused || !ACTIVE_STAGES.includes(lead.stage)) continue;

    const pending = b.followUps.filter((f) => f.status === 'PENDING').sort((a, c) => a.dueAt - c.dueAt);
    const due = pending.find((f) => f.dueAt <= now);
    const nextPending = pending[0];
    const meetings = b.meetings.filter((m) => m.status === 'SCHEDULED').sort((a, c) => a.scheduledAt - c.scheduledAt);

    for (const m of meetings) {
      if (m.scheduledAt >= now - 2 * 60 * 60 * 1000) upcomingMeetings.push({ prospectId: b.prospectId, businessName: b.businessName, scheduledAt: m.scheduledAt, kind: m.kind });
    }
    const soonMeeting = meetings.find((m) => m.scheduledAt <= now + DAY && m.scheduledAt >= now - 2 * 60 * 60 * 1000);
    const sentProposal = b.proposals.filter((p) => p.status === 'SENT').sort((a, c) => (c.sentAt ?? 0) - (a.sentAt ?? 0))[0];

    if (AWAITING_REPLY_STAGES.includes(lead.stage)) {
      awaitingReply.push({ prospectId: b.prospectId, businessName: b.businessName, stage: lead.stage, daysWaiting: daysSince(lead.lastContactAt, now), nextDueAt: nextPending?.dueAt });
    }
    if (lead.stage === 'PROPOSAL' && sentProposal) {
      proposalsAwaiting.push({ prospectId: b.prospectId, businessName: b.businessName, sentAt: sentProposal.sentAt, daysWaiting: daysSince(sentProposal.sentAt, now), total: sentProposal.quote.oneOffTotal });
    }

    /* 1. A meeting today/soon: prepare for the call. */
    if (soonMeeting) {
      actions.push({
        ...base, kind: 'PREPARE_CALL', title: 'Prepare for call',
        reason: `${soonMeeting.kind === 'VISIT' ? 'Visit' : 'Meeting'} ${new Date(soonMeeting.scheduledAt).toLocaleString('en-GB', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}.`,
        priority: 'HIGH', rank: 100, dueAt: soonMeeting.scheduledAt, overdue: false, cta: 'PREPARE_CALL',
      });
      continue;
    }

    /* 2. They replied and we owe them an answer. */
    if ((lead.stage === 'REPLIED' || lead.stage === 'INTERESTED') && (!nextPending || (due && due.dueAt <= now))) {
      actions.push({
        ...base, kind: 'REPLY_TO_PROSPECT', title: lead.stage === 'REPLIED' ? 'Reply and ask discovery questions' : 'Agree the next step',
        reason: lead.stage === 'REPLIED' ? 'They replied — keep the momentum while interest is fresh.' : 'They are interested — propose a demo, meeting or proposal.',
        priority: 'HIGH', rank: 90, dueAt: due?.dueAt, overdue: Boolean(due && due.dueAt < todayStart), cta: 'FOLLOW_UP',
      });
      continue;
    }

    /* 3. Proposal sent and gone quiet. */
    if (lead.stage === 'PROPOSAL' && sentProposal && due) {
      actions.push({
        ...base, kind: 'CHASE_PROPOSAL', title: 'Follow up on the proposal',
        reason: `Proposal sent ${daysSince(sentProposal.sentAt, now)} day(s) ago with no decision.`,
        priority: 'MEDIUM', rank: 75, dueAt: due.dueAt, overdue: due.dueAt < todayStart, cta: 'FOLLOW_UP',
      });
      continue;
    }

    /* 4. Scheduled follow-ups (no reply). */
    if (due && (AWAITING_REPLY_STAGES.includes(lead.stage) || ['MEETING', 'NEGOTIATION', 'PROPOSAL'].includes(lead.stage))) {
      const overdue = due.dueAt < todayStart;
      const dormancy = due.kind === 'DORMANCY_REVIEW';
      actions.push({
        ...base, kind: 'FOLLOW_UP',
        title: dormancy ? 'Close out: no reply after final follow-up' : `Follow up (${due.kind.replace('_', ' ').toLowerCase()})`,
        reason: dormancy
          ? 'Final follow-up got no reply. The lead will move to DORMANT — do not keep contacting.'
          : `Message sent ${daysSince(lead.lastContactAt, now)} day(s) ago with no response.`,
        priority: overdue ? 'HIGH' : 'MEDIUM', rank: 80 + Math.min(20, daysSince(due.dueAt, now) * 5), dueAt: due.dueAt, overdue,
        channel: lead.recommendedChannel, cta: 'FOLLOW_UP',
      });
      continue;
    }

    /* 5. Not yet contacted. (Demo feedback chases are scheduled as ordinary
     *    follow-ups when the demo is marked sent, so they surface in step 4.) */
    if (lead.stage === 'READY_TO_CONTACT') {
      const conf = brief?.confidence ?? 'MEDIUM';
      actions.push({
        ...base, kind: 'SEND_FIRST_MESSAGE', title: 'Send first message',
        reason: brief ? `${brief.opportunity} (${conf.toLowerCase()} confidence).` : 'Lead is ready to contact.',
        priority: conf === 'HIGH' ? 'HIGH' : conf === 'MEDIUM' ? 'MEDIUM' : 'LOW',
        rank: 60 + Math.round(b.score / 5) + (conf === 'HIGH' ? 10 : 0), overdue: false,
        channel: lead.recommendedChannel, cta: lead.selectedMessageId ? 'VIEW_MESSAGE' : 'GENERATE_MESSAGE',
      });
      continue;
    }
    if (lead.stage === 'QUALIFIED' || lead.stage === 'RESEARCHED') {
      if (brief?.channel.status === 'NO_DIRECT_CHANNEL') {
        manualResearch.push({
          ...base, kind: 'MANUAL_RESEARCH', title: 'Find contact details manually',
          reason: 'NO_DIRECT_CHANNEL — find decision-maker/contact information manually.',
          priority: 'MEDIUM', rank: 30, overdue: false, cta: 'OPEN_LEAD',
        });
        continue;
      }
      actions.push({
        ...base, kind: lead.stage === 'QUALIFIED' ? 'RESEARCH' : 'SEND_FIRST_MESSAGE',
        title: lead.stage === 'QUALIFIED' ? 'Generate sales research' : 'Choose and review the first message',
        reason: lead.stage === 'QUALIFIED' ? 'Qualified lead has no sales brief yet.' : 'Research is done — generate and pick a message.',
        priority: 'MEDIUM', rank: 45 + Math.round(b.score / 5), overdue: false,
        cta: lead.stage === 'QUALIFIED' ? 'RESEARCH' : 'GENERATE_MESSAGE',
      });
    }
  }

  actions.sort((a, b) => b.rank - a.rank);
  return {
    actions,
    overdueFollowUps: actions.filter((a) => a.overdue),
    manualResearch,
    awaitingReply: awaitingReply.sort((a, b) => b.daysWaiting - a.daysWaiting),
    upcomingMeetings: upcomingMeetings.sort((a, b) => a.scheduledAt - b.scheduledAt),
    proposalsAwaiting: proposalsAwaiting.sort((a, b) => b.daysWaiting - a.daysWaiting),
  };
}

/* ------------------------------ pipeline counts ------------------------------ */

/** Funnel index a stage counts as (for cumulative "ever reached" logic). */
export function funnelIndex(stage: SalesStage): number {
  switch (stage) {
    case 'DISCOVERED': return 0;
    case 'QUALIFIED': case 'RESEARCHED': case 'READY_TO_CONTACT': return 1;
    case 'CONTACTED': case 'FOLLOW_UP_1': case 'FOLLOW_UP_2': return 2;
    case 'REPLIED': return 3;
    case 'INTERESTED': return 4;
    case 'MEETING': return 5;
    case 'PROPOSAL': case 'NEGOTIATION': return 6;
    case 'WON': return 7;
    default: return -1; // LOST / NOT_A_FIT / DORMANT: decided by history
  }
}

export interface PipelineCounts {
  totalQualified: number;
  readyToContact: number;
  contacted: number;
  awaitingResponse: number;
  replied: number;
  interested: number;
  meetings: number;
  proposals: number;
  won: number;
  lost: number;
  dormant: number;
  notAFit: number;
  total: number;
  byStage: Record<SalesStage, number>;
}

export function pipelineCounts(leads: SalesLeadRow[]): PipelineCounts {
  const byStage = Object.fromEntries(
    ['DISCOVERED','QUALIFIED','RESEARCHED','READY_TO_CONTACT','CONTACTED','FOLLOW_UP_1','FOLLOW_UP_2','REPLIED','INTERESTED','MEETING','PROPOSAL','NEGOTIATION','WON','LOST','NOT_A_FIT','DORMANT'].map((s) => [s, 0]),
  ) as Record<SalesStage, number>;
  for (const l of leads) byStage[l.stage]++;
  const c = (...s: SalesStage[]) => s.reduce((n, x) => n + byStage[x], 0);
  const qualifiedAndBeyond = leads.filter((l) => !['DISCOVERED', 'NOT_A_FIT'].includes(l.stage) && (funnelIndex(l.stage) >= 1 || l.stage === 'LOST' || l.stage === 'DORMANT')).length;
  return {
    totalQualified: qualifiedAndBeyond,
    readyToContact: c('READY_TO_CONTACT'),
    contacted: leads.filter((l) => funnelIndex(l.stage) >= 2 || l.lastContactAt !== undefined).length,
    awaitingResponse: c('CONTACTED', 'FOLLOW_UP_1', 'FOLLOW_UP_2'),
    replied: c('REPLIED'),
    interested: c('INTERESTED'),
    meetings: c('MEETING'),
    proposals: c('PROPOSAL', 'NEGOTIATION'),
    won: c('WON'),
    lost: c('LOST'),
    dormant: c('DORMANT'),
    notAFit: c('NOT_A_FIT'),
    total: leads.length,
    byStage,
  };
}

export { FUNNEL_ORDER };
