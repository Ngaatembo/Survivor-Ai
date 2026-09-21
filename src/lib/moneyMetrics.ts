import type { Offer, Prospect, RealRevenueEntry } from '../types';

export interface MoneyMetrics {
  realRevenue: number;
  pipelineValue: number;
  contacted: number;
  responses: number;
  proposals: number;
  wins: number;
  responseRate: number | null;
  proposalRate: number | null;
  closeRate: number | null;
  revenuePerContacted: number | null;
  revenuePerQualified: number | null;
}

const respondedStatuses = new Set(['REPLIED', 'INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON']);
const closedStatuses = new Set(['WON', 'LOST', 'NOT_INTERESTED']);

export function computeMoneyMetrics(
  prospects: Prospect[],
  _offers: Offer[],
  realRevenue: RealRevenueEntry[],
): MoneyMetrics {
  const contacted = prospects.filter((p) => p.status !== 'DISCOVERED' && p.status !== 'QUALIFIED').length;
  const responses = prospects.filter((p) => respondedStatuses.has(p.status)).length;
  const proposals = prospects.filter((p) => p.status === 'PROPOSAL_SENT' || p.status === 'NEGOTIATING' || p.status === 'WON').length;
  const wins = prospects.filter((p) => p.status === 'WON').length;
  const revenue = realRevenue.reduce((sum, r) => sum + r.amountReceived, 0);
  const qualified = prospects.filter((p) => p.status !== 'DISCOVERED').length;
  const pipelineValue = prospects
    .filter((p) => !closedStatuses.has(p.status))
    .reduce((sum, p) => sum + Math.max(0, p.score.expectedValue), 0);

  return {
    realRevenue: revenue,
    pipelineValue,
    contacted,
    responses,
    proposals,
    wins,
    responseRate: contacted ? responses / contacted : null,
    proposalRate: contacted ? proposals / contacted : null,
    closeRate: contacted ? wins / contacted : null,
    revenuePerContacted: contacted ? revenue / contacted : null,
    revenuePerQualified: qualified ? revenue / qualified : null,
  };
}
