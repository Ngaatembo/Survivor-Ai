import type {
  Offer,
  OutreachMessageSet,
  Prospect,
  ProspectDemo,
  ProspectIntelligence,
  MarketPriceResearch,
} from '../types';

export type SalesReadinessState =
  | 'RESEARCHING'
  | 'PARTIALLY_READY'
  | 'READY_FOR_REVIEW'
  | 'CONTACTED'
  | 'FOLLOW_UP_DUE'
  | 'NEGOTIATING'
  | 'WON'
  | 'LOST';

export interface SalesReadiness {
  state: SalesReadinessState;
  label: string;
  complete: number;
  total: number;
  missing: string[];
}

export function salesReadiness(
  prospect: Prospect,
  intelligence?: ProspectIntelligence,
  offer?: Offer,
  demo?: Omit<ProspectDemo, 'html'>,
  outreach?: OutreachMessageSet,
  marketPrice?: MarketPriceResearch,
  now = Date.now(),
): SalesReadiness {
  if (prospect.status === 'WON') return { state: 'WON', label: 'Won', complete: 0, total: 0, missing: [] };
  if (prospect.status === 'LOST' || prospect.status === 'NOT_INTERESTED') {
    return { state: 'LOST', label: 'Closed / lost', complete: 0, total: 0, missing: [] };
  }
  if (prospect.status === 'NEGOTIATING' || prospect.status === 'PROPOSAL_SENT') {
    return { state: 'NEGOTIATING', label: 'Negotiating', complete: 0, total: 0, missing: [] };
  }
  if (prospect.nextFollowUpAt && prospect.nextFollowUpAt <= now && prospect.status !== 'DISCOVERED' && prospect.status !== 'QUALIFIED') {
    return { state: 'FOLLOW_UP_DUE', label: 'Follow-up due', complete: 0, total: 0, missing: [] };
  }
  if (prospect.status === 'CONTACTED' || prospect.status === 'REPLIED' || prospect.status === 'INTERESTED') {
    return { state: 'CONTACTED', label: 'Contacted', complete: 0, total: 0, missing: [] };
  }

  const verificationReady = prospect.verification?.status === 'VERIFIED' || prospect.verification?.status === 'PROVISIONAL';
  const pricingReady = Boolean(marketPrice && marketPrice.sources.length > 0);
  const checks = [
    ['Identity/contact verified', verificationReady],
    ['Business research', Boolean(intelligence)],
    ['Market pricing', pricingReady],
    ['Offer', Boolean(offer)],
    ['Demo', Boolean(demo)],
    ['Outreach', Boolean(outreach)],
  ] as const;
  const complete = checks.filter(([, ok]) => ok).length;
  const missing = checks.filter(([, ok]) => !ok).map(([label]) => label);

  if (complete === checks.length) {
    return { state: 'READY_FOR_REVIEW', label: 'Ready for review', complete, total: checks.length, missing };
  }
  return {
    state: complete === 0 ? 'RESEARCHING' : 'PARTIALLY_READY',
    label: complete === 0 ? 'Researching' : 'Partially ready',
    complete,
    total: checks.length,
    missing,
  };
}
