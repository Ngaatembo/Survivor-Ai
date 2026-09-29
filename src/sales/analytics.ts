/* ============================================================================
 * Sales analytics — which approaches actually work.
 * ----------------------------------------------------------------------------
 * Small samples lie, so every "best performing" claim needs a minimum number
 * of contacts before it is shown; below that the UI says "not enough data".
 * Revenue here is what the salesperson recorded when marking a lead WON — it
 * is NOT verified payment (verified revenue lives in Real Revenue).
 * ========================================================================== */

import { funnelIndex } from './actions';
import {
  CHANNEL_LABEL,
  FUNNEL_ORDER,
  STAGE_LABEL,
  type SalesLeadRow,
  type SalesMessage,
  type SalesStage,
} from './types';

export interface StageHistoryRow { prospectId: string; fromStage?: SalesStage; toStage: SalesStage; at: number }

export interface RateRow { key: string; label: string; contacted: number; replied: number; replyRate: number | null }

export interface SalesAnalytics {
  funnel: { stage: SalesStage; label: string; reached: number }[];
  conversions: { label: string; from: number; to: number; rate: number | null }[];
  byChannel: RateRow[];
  byAngle: RateRow[];
  byMessageType: RateRow[];
  best: {
    channel: RateRow | null;
    angle: RateRow | null;
    messageType: RateRow | null;
  };
  avgHoursToReply: number | null;
  avgDaysToClose: number | null;
  lostReasons: { reason: string; count: number }[];
  revenue: { recordedTotal: number; wonCount: number; averageDeal: number | null; note: string };
  minSample: number;
  learningReady: boolean;
  notes: string[];
}

export const MIN_SAMPLE = 5;

export function computeSalesAnalytics(
  leads: SalesLeadRow[],
  history: StageHistoryRow[],
  messages: SalesMessage[],
): SalesAnalytics {
  const histBy = new Map<string, StageHistoryRow[]>();
  for (const h of history) {
    const arr = histBy.get(h.prospectId) ?? [];
    arr.push(h);
    histBy.set(h.prospectId, arr);
  }

  // Highest funnel step each lead has ever reached.
  const maxIdx = new Map<string, number>();
  for (const l of leads) {
    let m = funnelIndex(l.stage);
    for (const h of histBy.get(l.prospectId) ?? []) m = Math.max(m, funnelIndex(h.toStage));
    if (l.lastContactAt !== undefined) m = Math.max(m, 2);
    maxIdx.set(l.prospectId, m);
  }
  const reachedAtLeast = (i: number) => leads.filter((l) => (maxIdx.get(l.prospectId) ?? -1) >= i).length;

  const funnel = FUNNEL_ORDER.map((stage, i) => ({ stage, label: STAGE_LABEL[stage], reached: reachedAtLeast(i) }));
  const conv = (label: string, a: number, b: number) => ({ label, from: funnel[a].reached, to: funnel[b].reached, rate: funnel[a].reached ? funnel[b].reached / funnel[a].reached : null });
  const conversions = [
    conv('Discovered → Qualified', 0, 1),
    conv('Qualified → Contacted', 1, 2),
    conv('Contacted → Replied', 2, 3),
    conv('Replied → Interested', 3, 4),
    conv('Interested → Meeting', 4, 5),
    conv('Meeting → Proposal', 5, 6),
    conv('Proposal → Won', 6, 7),
  ];

  // Reply rates by how the FIRST message was actually sent.
  const firstSent = new Map<string, SalesMessage>();
  for (const m of messages.filter((x) => x.kind === 'FIRST_CONTACT' && x.status === 'SENT').sort((a, b) => (a.sentAt ?? 0) - (b.sentAt ?? 0))) {
    if (!firstSent.has(m.prospectId)) firstSent.set(m.prospectId, m);
  }
  const rate = (keyOf: (m: SalesMessage) => string | undefined, labelOf: (k: string) => string): RateRow[] => {
    const acc = new Map<string, { c: number; r: number }>();
    for (const [pid, m] of firstSent) {
      const k = keyOf(m);
      if (!k) continue;
      const e = acc.get(k) ?? { c: 0, r: 0 };
      e.c++;
      if ((maxIdx.get(pid) ?? -1) >= 3) e.r++;
      acc.set(k, e);
    }
    return [...acc.entries()]
      .map(([key, e]) => ({ key, label: labelOf(key), contacted: e.c, replied: e.r, replyRate: e.c ? e.r / e.c : null }))
      .sort((a, b) => (b.replyRate ?? 0) - (a.replyRate ?? 0) || b.contacted - a.contacted);
  };
  const byChannel = rate((m) => m.channel, (k) => CHANNEL_LABEL[k as keyof typeof CHANNEL_LABEL] ?? k);
  const byAngle = rate((m) => m.angle, (k) => k.replace(/_/g, ' ').toLowerCase());
  const byMessageType = rate((m) => m.variant, (k) => k.charAt(0) + k.slice(1).toLowerCase());
  const best = (rows: RateRow[]) => rows.find((r) => r.contacted >= MIN_SAMPLE) ?? null;

  // Time to reply / to close.
  const firstAt = (pid: string, stage: SalesStage) =>
    (histBy.get(pid) ?? []).filter((h) => h.toStage === stage).sort((a, b) => a.at - b.at)[0]?.at;
  const replyGaps: number[] = [];
  const closeGaps: number[] = [];
  for (const l of leads) {
    const contacted = firstAt(l.prospectId, 'CONTACTED');
    const replied = firstAt(l.prospectId, 'REPLIED');
    if (contacted && replied && replied >= contacted) replyGaps.push(replied - contacted);
    if (l.stage === 'WON' && contacted && l.wonAt && l.wonAt >= contacted) closeGaps.push(l.wonAt - contacted);
  }
  const avg = (a: number[]) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
  const avgReply = avg(replyGaps);
  const avgClose = avg(closeGaps);

  const lost = new Map<string, number>();
  for (const l of leads) if (l.stage === 'LOST') lost.set(l.lostReason ?? 'OTHER', (lost.get(l.lostReason ?? 'OTHER') ?? 0) + 1);

  const won = leads.filter((l) => l.stage === 'WON');
  const recorded = won.reduce((s, l) => s + (l.wonValue ?? 0), 0);

  const contactedTotal = funnel[2].reached;
  const notes: string[] = [];
  if (contactedTotal < MIN_SAMPLE) notes.push(`Only ${contactedTotal} lead(s) contacted so far — need at least ${MIN_SAMPLE} before any approach can be called "best".`);
  if (replyGaps.length === 0 && funnel[3].reached > 0) notes.push('Reply timing is only measured for leads whose CONTACTED and REPLIED dates were both recorded here.');

  return {
    funnel,
    conversions,
    byChannel,
    byAngle,
    byMessageType,
    best: { channel: best(byChannel), angle: best(byAngle), messageType: best(byMessageType) },
    avgHoursToReply: avgReply === null ? null : avgReply / 3_600_000,
    avgDaysToClose: avgClose === null ? null : avgClose / 86_400_000,
    lostReasons: [...lost.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count),
    revenue: {
      recordedTotal: recorded,
      wonCount: won.length,
      averageDeal: won.length ? recorded / won.length : null,
      note: 'Deal values entered when marking a lead won. Verified payments are tracked separately in Real Revenue.',
    },
    minSample: MIN_SAMPLE,
    learningReady: contactedTotal >= MIN_SAMPLE,
    notes,
  };
}
