import type { EconomicMemorySnapshot, RealRevenueEntry } from '../types';

export function buildEconomicMemory(entries: RealRevenueEntry[], now = Date.now()): EconomicMemorySnapshot {
  const valid = entries.filter((e) => Number.isFinite(e.amountReceived) && e.amountReceived >= 0);
  const totalRevenue = valid.reduce((sum, e) => sum + e.amountReceived, 0);
  const totalCosts = valid.reduce((sum, e) => sum + (Number.isFinite(e.costs) ? e.costs : 0), 0);
  const totalProfit = valid.reduce((sum, e) => sum + (Number.isFinite(e.profit) ? e.profit : e.amountReceived - (e.costs || 0)), 0);
  const paidDays = valid.filter((e) => Number.isFinite(e.daysFromDiscoveryToPayment) && e.daysFromDiscoveryToPayment >= 0);
  const byOpportunity = aggregate(valid, (e) => e.opportunityId || 'unknown', (e) => e.opportunityName || e.opportunityId);
  const byAcquisitionChannel = aggregateChannel(valid);
  const observedLessons: string[] = [];

  if (valid.length === 0) {
    observedLessons.push('No real sales are recorded yet. Survivor must not claim that any opportunity has proven demand.');
  } else {
    const fastest = [...valid].sort((a, b) => a.daysFromDiscoveryToPayment - b.daysFromDiscoveryToPayment)[0];
    const highestProfit = [...valid].sort((a, b) => b.profit - a.profit)[0];
    observedLessons.push(
      \`Recorded evidence: \${valid.length} paid sale\${valid.length === 1 ? '' : 's'}, \${money(totalRevenue)} revenue and \${money(totalProfit)} recorded profit.\`,
    );
    if (fastest) observedLessons.push(\`Fastest recorded time-to-payment: \${fastest.daysFromDiscoveryToPayment} day\${fastest.daysFromDiscoveryToPayment === 1 ? '' : 's'} (\${fastest.opportunityName}).\`);
    if (highestProfit) observedLessons.push(\`Highest recorded profit: \${money(highestProfit.profit)} from \${highestProfit.opportunityName}.\`);
    const top = [...byOpportunity].sort((a, b) => b.revenue - a.revenue)[0];
    if (top && byOpportunity.length > 1) observedLessons.push(\`Revenue is distributed across \${byOpportunity.length} opportunity types; the largest recorded contributor is \${top.opportunityName} with \${money(top.revenue)}.\`);
  }

  return {
    generatedAt: now,
    sampleSize: valid.length,
    totalRevenue,
    totalCosts,
    totalProfit,
    averageRevenuePerSale: valid.length ? totalRevenue / valid.length : null,
    averageProfitPerSale: valid.length ? totalProfit / valid.length : null,
    averageDaysToPayment: paidDays.length ? paidDays.reduce((s, e) => s + e.daysFromDiscoveryToPayment, 0) / paidDays.length : null,
    byOpportunity,
    byAcquisitionChannel,
    observedLessons,
    dataQuality: valid.length === 0 ? 'NONE' : valid.length < 5 ? 'EARLY' : 'ESTABLISHED',
  };
}

function aggregate(entries: RealRevenueEntry[], key: (e: RealRevenueEntry) => string, name: (e: RealRevenueEntry) => string) {
  const map = new Map<string, { opportunityId: string; opportunityName: string; sales: number; revenue: number; profit: number; days: number[] }>();
  for (const e of entries) {
    const id = key(e);
    const row = map.get(id) ?? { opportunityId: id, opportunityName: name(e), sales: 0, revenue: 0, profit: 0, days: [] };
    row.sales += 1;
    row.revenue += e.amountReceived;
    row.profit += e.profit;
    if (Number.isFinite(e.daysFromDiscoveryToPayment) && e.daysFromDiscoveryToPayment >= 0) row.days.push(e.daysFromDiscoveryToPayment);
    map.set(id, row);
  }
  return [...map.values()].map((row) => ({
    opportunityId: row.opportunityId,
    opportunityName: row.opportunityName,
    sales: row.sales,
    revenue: row.revenue,
    profit: row.profit,
    averageDaysToPayment: row.days.length ? row.days.reduce((s, d) => s + d, 0) / row.days.length : null,
  }));
}

function aggregateChannel(entries: RealRevenueEntry[]) {
  const map = new Map<string, { channel: string; sales: number; revenue: number; profit: number }>();
  for (const e of entries) {
    const channel = e.acquisitionChannel.trim() || 'Unknown';
    const row = map.get(channel) ?? { channel, sales: 0, revenue: 0, profit: 0 };
    row.sales += 1;
    row.revenue += e.amountReceived;
    row.profit += e.profit;
    map.set(channel, row);
  }
  return [...map.values()].sort((a, b) => b.revenue - a.revenue);
}

function money(value: number) {
  return \`$\${value.toFixed(2)}\`;
}
