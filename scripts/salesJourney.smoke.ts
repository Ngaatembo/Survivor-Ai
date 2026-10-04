/* Sales system journey test — real handleSalesRoute + D1Repository on a local
 * in-memory D1 (miniflare). Run: npx tsx scripts/salesJourney.smoke.ts */
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';
import { D1Repository } from '../src/engine/d1Repository';
import { handleSalesRoute } from '../worker/src/sales';
import type { Prospect } from '../src/types';
import { offerFitsProblem } from '../src/sales/intelligence';

let failed = 0;
const ok = (c: unknown, m: string) => { if (!c) { failed++; console.log('  FAIL', m); } else console.log('  ok  ', m); };

const mf = new Miniflare({ modules: true, script: 'export default { fetch(){ return new Response("x") } }', d1Databases: { DB: 'test' } });
const db: any = await mf.getD1Database('DB');
const sqlFiles = ['schema.d1.sql', ...readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort().map((f) => 'migrations/' + f)];
for (const stmt of sqlFiles.map((f) => readFileSync(f, 'utf8')).join(';\n').split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) {
  try { await db.prepare(stmt).run(); } catch (e) { /* tolerate PRAGMA/dup */ }
}
await db.prepare("INSERT OR IGNORE INTO agents (id, name) VALUES ('agent-survive-01','Test')").run().catch(() => {});
const repo = new D1Repository(db);
const now = Date.now();
const prospect: Prospect = {
  id: 'p-test-1', opportunityId: 'opp-1', opportunityName: 'Local service websites',
  businessName: 'Marondera Auto Body', category: 'Auto body repair', location: 'Marondera',
  websitePresence: 'SOCIAL_ONLY', socialLinks: ['https://facebook.com/maronderaautobody'],
  contactChannel: 'WHATSAPP', contactValue: '0772 123 456',
  verification: { status: 'VERIFIED', confidence: 82, businessNameMatchScore: 0.95, contactMatchScore: 0.9, independentSources: 2, contactSources: 2 } as any,
  sources: [{ id: 's1', title: 'Facebook page', url: 'https://facebook.com/maronderaautobody', kind: 'web' }, { id: 's2', title: 'Business directory', url: 'https://example.com/maronderaautobody', kind: 'web' }],
  evidenceNotes: 'Active Facebook page with photos of repairs.', priority: 'HIGH',
  score: { total: 74, factors: ['Active social presence', 'No website found'], expectedDealValue: 250, expectedAcquisitionCost: 5, expectedProfit: 200, expectedTimeToRevenueDays: 10, probabilityOfClose: 0.2, expectedValue: 40, scoredAt: now },
  status: 'QUALIFIED', dataSource: 'LIVE', dateDiscovered: now, messagesSentCount: 0, responsesReceivedCount: 0,
  actualRevenue: 0, notes: [], createdAt: now, updatedAt: now,
};
import { SAMPLE_OPPORTUNITIES } from '../src/data/sampleData';
await repo.upsertOpportunities([{ ...SAMPLE_OPPORTUNITIES[0], id: 'opp-1' }]);
await repo.upsertProspects([prospect]);
const before = (await repo.listProspects()).length;

const env: any = { DB: db, DB_BACKEND: 'd1', TRIGGER_SECRET: 's' };
const json = (d: unknown, i?: ResponseInit) => new Response(JSON.stringify(d), i);
async function call(method: string, path: string, body?: unknown, authed = true): Promise<any> {
  const u = new URL('http://x' + path);
  const r = await handleSalesRoute(new Request(u, { method, body: body ? JSON.stringify(body) : undefined, headers: { 'content-type': 'application/json' } }), env, u, { repo, json, isOperator: async () => authed });
  return { status: r!.status, ...(await r!.json() as any) };
}
const P = { prospectId: prospect.id };

console.log('auth');
ok((await call('GET', '/sales/pipeline', undefined, false)).status === 401, 'unauthenticated request rejected');

console.log('pipeline import (no duplicates)');
let pl = await call('GET', '/sales/pipeline'); if (!pl.leads) console.log(pl);
ok(pl.leads.length === 1, 'lead imported into pipeline');
pl = await call('GET', '/sales/pipeline');
ok(pl.leads.length === 1, 'second load does not duplicate');
ok((await repo.listProspects()).length === before, 'discovery prospects untouched');

console.log('safety gates');
const unsafe: Prospect = {
  ...prospect,
  id: 'p-unsafe-1',
  businessName: 'Unverified Auto Body',
  verification: { status: 'PROVISIONAL', confidence: 78, businessNameMatchScore: 0.94, contactMatchScore: 0.9, independentSources: 2, contactSources: 2 } as any,
  contactValue: '0772 999 888',
  sources: [{ id: 's-unsafe', title: 'Search result', url: 'https://example.com/unsafe', kind: 'web' }],
  status: 'DISCOVERED',
};
await repo.upsertProspects([unsafe]);
const unsafePipeline = await call('GET', '/sales/pipeline');
ok(unsafePipeline.leads.some((l: any) => l.prospectId === unsafe.id), 'unsafe test lead imported');
const unsafeReady = await call('POST', '/sales/stage', { prospectId: unsafe.id, stage: 'READY_TO_CONTACT' });
ok(!unsafeReady.ok, 'provisional identity cannot reach READY_TO_CONTACT');
const unsafeForced = await call('POST', '/sales/stage', { prospectId: unsafe.id, stage: 'READY_TO_CONTACT', force: true });
ok(!unsafeForced.ok, 'force cannot bypass evidence gate');
const unsafeOffer = await call('POST', '/sales/offer/generate', { prospectId: unsafe.id });
ok(!unsafeOffer.ok, 'provisional identity cannot generate an offer');
const unsafeMessage = await call('POST', '/sales/message/generate', { prospectId: unsafe.id });
ok(!unsafeMessage.ok, 'provisional identity cannot generate outreach');

console.log('research + brief');
const rs = await call('POST', '/sales/research', P);
ok(rs.ok && rs.brief.channel.status === 'RECOMMENDED', 'channel recommended: ' + rs.brief?.channel?.channel);
ok(rs.brief.evidence.every((f: any) => ['VERIFIED', 'INFERENCE', 'UNKNOWN'].includes(f.kind)), 'evidence tagged');

const healthySite = {
  ...prospect,
  websitePresence: 'ADEQUATE',
  verification: {
    ...prospect.verification,
    websiteAudit: { status: 'AUDITED', verdict: 'HEALTHY', score: 94, criticalIssues: [], opportunities: [] },
  },
} as Prospect;
const problemIntel = {
  primaryProblem: {
    type: 'DISCOVERABILITY',
    confidence: 'HIGH',
    solvableOpportunity: 'Improve search visibility',
    outreachClaim: 'Customers may have difficulty finding the business in search.',
    sourceIds: ['s1', 's2'],
  },
} as any;
ok(!offerFitsProblem(healthySite, problemIntel, 'Build a new professional website'), 'healthy existing website blocks a new-website offer');
ok(offerFitsProblem(healthySite, problemIntel, 'Improve SEO and Google visibility'), 'healthy existing website can receive an evidence-matched SEO offer');

console.log('messages');
const g = await call('POST', '/sales/message/generate', P);
ok(g.ok && g.messages.length >= 2 && g.messages.length <= 3, `${g.messages?.length} variants`);
ok(new Set(g.messages.map((m: any) => m.body)).size === g.messages.length, 'variants not identical');
ok(!g.messages.some((m: any) => /\$\d/.test(m.body)), 'no price in first message');
const sel = await call('POST', '/sales/message/select', { messageId: g.messages[0].id });
ok(sel.ok, 'message selected');

console.log('stage journey');
const step = async (stage: string, extra: any = {}) => { const r = await call('POST', '/sales/stage', { ...P, stage, ...extra }); ok(r.ok, `-> ${stage}${r.ok ? '' : ' (' + r.error + ')'}`); return r; };
let prof = await call('GET', '/sales/lead?prospectId=' + prospect.id);
console.log('  stage now', prof.state.stage);
if (prof.state.stage !== 'READY_TO_CONTACT') await step('READY_TO_CONTACT');
const skip = await call('POST', '/sales/stage', { ...P, stage: 'WON' });
ok(!skip.ok, 'cannot jump straight to WON');
await step('CONTACTED', { messageId: g.messages[0].id });
prof = await call('GET', '/sales/lead?prospectId=' + prospect.id);
ok(prof.followUps.some((f: any) => f.status === 'PENDING'), 'follow-up scheduled after contact');
const fu = await call('POST', '/sales/follow-up/generate', { ...P, situation: 'NO_RESPONSE_1' });
ok(fu.ok && fu.followUp.message.length > 20, 'follow-up generated');
await step('REPLIED'); await step('INTERESTED');
const mt = await call('POST', '/sales/meeting', { ...P, scheduledAt: new Date(now + 86400000).toISOString(), kind: 'CALL' });
ok(mt.ok, 'meeting booked');
const pr = await call('POST', '/sales/proposal', P);
ok(pr.ok && ['PRICED', 'MANUAL_REVIEW_REQUIRED'].includes(pr.proposal.quote.priceStatus), 'proposal quote ' + pr.proposal?.quote?.priceStatus);
const won = await call('POST', '/sales/won', { ...P, value: 250 });
ok(won.ok, 'marked WON: ' + (won.error ?? ''));
const an = await call('GET', '/sales/analytics');
ok(an.analytics.revenue.wonCount === 1 && an.analytics.revenue.recordedTotal === 250, 'analytics reflect the win');
const legacy = (await repo.listProspects())[0];
console.log('  legacy prospect status:', legacy.status);

console.log('lost path + settings');
const lostBad = await call('POST', '/sales/lost', { ...P, reason: 'made up' });
ok(!lostBad.ok, 'free-text lost reason rejected');
const st = await call('POST', '/sales/settings', { pricing: { admin_panel_addon: 80 } });
ok(st.ok && st.pricing.admin_panel_addon === 80, 'pricing editable');

await mf.dispose();
console.log(failed ? `\n${failed} FAILED` : '\nALL PASSED');
process.exit(failed ? 1 : 0);
