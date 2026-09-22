import type { EconomicMemorySnapshot, RealRevenueEntry } from '../types';

export type IncomeChannelKind = 'NWT_DEV_SERVICES'|'WEBSITES'|'WHATSAPP_BOTS'|'AUTOMATION'|'CONTENT_SOCIAL'|'FREELANCE_REMOTE'|'DIGITAL_PRODUCTS'|'EDUCATION_TUTORING'|'AFFILIATE_REFERRAL'|'TRADING_RESEARCH'|'OTHER';
export type IncomeChannelLifecycle = 'RESEARCHING'|'READY_TO_TEST'|'TESTING'|'PROVEN'|'FAILED'|'SCALING';

export interface IncomeChannelStrategy {
  kind: IncomeChannelKind; name: string; category: 'SERVICE'|'MEDIA'|'PRODUCT'|'EDUCATION'|'REFERRAL'|'TRADING'|'OTHER';
  lifecycle: IncomeChannelLifecycle; marketId: string; customer: string; problemToSolve: string; delivery: string;
  demandQueries: string[]; requiredHumanAction: string; risk: 'LOW'|'MEDIUM'|'HIGH'|'VERY_HIGH';
  testCost: 'NONE'|'LOW'|'MEDIUM'|'HIGH'|'CAPITAL_AT_RISK'; evidenceRequired: string[]; guardrails: string[]; nextExperiment: string;
}

const base = (kind: IncomeChannelKind, name: string, category: IncomeChannelStrategy['category'], marketId: string, customer: string, problemToSolve: string, delivery: string, queries: string[], action: string, risk: IncomeChannelStrategy['risk'], testCost: IncomeChannelStrategy['testCost'], nextExperiment: string): IncomeChannelStrategy => ({
  kind,name,category,lifecycle:'READY_TO_TEST',marketId,customer,problemToSolve,delivery,demandQueries:queries,requiredHumanAction:action,risk,testCost,
  evidenceRequired:['real demand evidence','credible delivery path','pricing or terms evidence'],
  guardrails:['No autonomous outreach','No fabricated contacts, prices, revenue or results'],nextExperiment
});

export const INCOME_CHANNEL_STRATEGIES: IncomeChannelStrategy[] = [
  base('NWT_DEV_SERVICES','NWT Dev services','SERVICE','ZW','Zimbabwean SMEs','Digital presence, lead capture and business workflows','Research → demo → human outreach → delivery → payment',['Zimbabwe businesses needing websites','Zimbabwe small business digital services'],'Review evidence and contact the business yourself.','LOW','LOW','Research and qualify a real business with a specific problem.'),
  base('WEBSITES','Website builds','SERVICE','ZW','Businesses without an adequate website','Lost trust, visibility and enquiries','Research → demo → offer → human outreach → build → payment',['Zimbabwe business website demand','Zimbabwe website design prices 2026'],'Approve the prospect and send the prepared offer manually.','LOW','LOW','Build one evidence-backed demo for a qualified prospect.'),
  base('WHATSAPP_BOTS','WhatsApp business bots','SERVICE','ZW','Businesses receiving repetitive customer questions','Slow replies, missed enquiries and repetitive work','Map FAQs/workflow → prototype → demo → offer → human-approved deployment',['Zimbabwe businesses WhatsApp automation','WhatsApp chatbot Zimbabwe small business'],'Choose a business and approve the bot offer before contact.','LOW','LOW','Find a business with repeated customer questions and create a small demo.'),
  base('AUTOMATION','Business automation','SERVICE','ZW','SMEs with repetitive admin work','Manual data entry, follow-ups and fragmented workflows','Workflow audit → prototype → human-approved deployment',['Zimbabwe business process automation','Zimbabwe SME automation services'],'Approve the workflow and client proposal.','LOW','LOW','Identify one repetitive workflow from a real business.'),
  base('CONTENT_SOCIAL','Content & social','MEDIA','ZW','Audiences and brands','Useful content and distribution','Research topic → create → human publishes → measure revenue',['Zimbabwe creator monetization 2026','Zimbabwe social media sponsorship opportunities'],'Review and publish content yourself.','MEDIUM','LOW','Run a small content experiment and record actual reach and revenue.'),
  base('FREELANCE_REMOTE','Freelance / remote work','SERVICE','GB','Remote clients','Specific development or technical work','Find legitimate brief → prepare application → human submits → deliver → get paid',['remote junior web developer contracts Africa','remote TypeScript React freelance opportunities'],'Review and submit applications yourself.','LOW','LOW','Find one legitimate matching project and prepare an application.'),
  base('DIGITAL_PRODUCTS','Digital products','PRODUCT','ZW','Businesses or learners with a repeated need','A recurring problem that can be packaged once and sold repeatedly','Validate demand → build small product → human launch → track sales',['Zimbabwe small business templates demand','Africa digital product demand for SMEs'],'Approve product scope and launch.','MEDIUM','LOW','Identify a repeated client problem worth packaging.'),
  base('EDUCATION_TUTORING','Education & tutoring','EDUCATION','ZW','Students needing explanation and tutoring','Understanding difficult topics and preparing for learning tasks','Explain concepts, study plans, practice and feedback',['Zimbabwe tutoring demand online','Zimbabwe O Level tutoring opportunities'],'Review and deliver tutoring personally.','LOW','LOW','Offer a small tutoring/study-support package and record real demand.'),
  base('AFFILIATE_REFERRAL','Affiliate / referral','REFERRAL','ZW','Relevant audiences or clients','Connect people with useful products/services','Verify program → relevant recommendation → track commission',['Zimbabwe technology affiliate programs 2026','Africa hosting software affiliate programs'],'Approve any recommendation before publishing.','MEDIUM','NONE','Verify one legitimate program and test a relevant recommendation.'),
  {
    kind:'TRADING_RESEARCH',name:'Forex research / paper trading',category:'TRADING',lifecycle:'RESEARCHING',marketId:'ZW',customer:'N/A — capital activity',
    problemToSolve:'Test whether a documented trading strategy has evidence before risking capital',
    delivery:'Market research → strategy definition → backtest → paper trade → review → human decision',
    demandQueries:['Tembo forex bot','Tembo Forex Bot trading strategy','forex bot Zimbabwe','MT5 forex bot backtesting'],
    requiredHumanAction:'Review evidence and explicitly decide whether any real-money action is appropriate.',risk:'VERY_HIGH',testCost:'CAPITAL_AT_RISK',
    evidenceRequired:['strategy rules','backtest data','paper-trading results','broker/regulatory checks'],
    guardrails:['Research and paper trading only','No autonomous live orders','No deposits or withdrawals','No profitability claims from backtests alone'],
    nextExperiment:'Research the Tembo Forex Bot and comparable systems, then build a paper-trading evaluation record.'
  },
  base('OTHER','Emerging opportunities','OTHER','ZW','Varies','New evidence-backed opportunities','Research → validate → small human-approved experiment',['Zimbabwe online income opportunities 2026'],'Review before action.','MEDIUM','LOW','Classify a newly discovered opportunity.')
];

export function decideIncomeChannel(strategy: IncomeChannelStrategy, memory: EconomicMemorySnapshot, entries: RealRevenueEntry[]) {
  const token = strategy.kind.toLowerCase().replace(/[^a-z0-9]+/g,'_');
  const matching = entries.filter(e => (e.acquisitionChannel || '').toLowerCase().replace(/[^a-z0-9]+/g,'_').includes(token));
  const revenue = matching.reduce((s,e)=>s+e.amountReceived,0);
  let lifecycle: IncomeChannelLifecycle = strategy.lifecycle;
  if (matching.length >= 5 && revenue > 0) lifecycle='PROVEN'; else if (matching.length > 0) lifecycle='TESTING';
  if (strategy.kind==='TRADING_RESEARCH') lifecycle='RESEARCHING';
  return { channel: strategy.kind, lifecycle, reasons: [
    strategy.kind==='TRADING_RESEARCH' ? 'Trading stays research/paper-trading only until independently observed evidence exists.' : 'No channel is proven from forecasts alone.',
    matching.length ? `${matching.length} real sale(s) are recorded for this channel.` : 'No real sales are recorded for this channel yet.',
    memory.dataQuality==='NONE' ? 'Economic memory has no verified revenue yet.' : `Economic memory contains ${memory.sampleSize} verified sale(s).`
  ], nextExperiment: strategy.nextExperiment, realRevenue: revenue, realSales: matching.length };
}

export interface IncomeExecutionPlan {
  channel: IncomeChannelKind;
  objective: string;
  steps: string[];
  humanActions: string[];
  evidenceToCollect: string[];
  successMetrics: string[];
  stopConditions: string[];
  currentEvidence: { realSales: number; realRevenue: number; dataQuality: EconomicMemorySnapshot['dataQuality'] };
}

export function buildIncomeExecutionPlan(
  strategy: IncomeChannelStrategy,
  memory: EconomicMemorySnapshot,
  entries: RealRevenueEntry[],
): IncomeExecutionPlan {
  const decision = decideIncomeChannel(strategy, memory, entries);
  const common = {
    currentEvidence: {
      realSales: decision.realSales,
      realRevenue: decision.realRevenue,
      dataQuality: memory.dataQuality,
    },
    successMetrics: ['real customer response', 'actual payment received', 'recorded delivery cost', 'time from discovery to payment'],
    stopConditions: ['no credible demand after the defined test', 'delivery cost or effort makes the offer uneconomic', 'evidence cannot be independently verified'],
  };

  const plans: Record<IncomeChannelKind, Pick<IncomeExecutionPlan, 'objective'|'steps'|'humanActions'|'evidenceToCollect'>> = {
    NWT_DEV_SERVICES: {
      objective: 'Turn verified Zimbabwe business problems into paid NWT Dev work and recurring support.',
      steps: ['Find a real business problem', 'verify identity, contact and location', 'research market pricing', 'build a focused demo/offer', 'human outreach', 'record response, payment and delivery outcome'],
      humanActions: ['approve the prospect', 'send outreach', 'negotiate and accept work', 'deliver the service', 'record real revenue'],
      evidenceToCollect: ['verified business/contact evidence', 'problem evidence', 'pricing sources', 'offer/deliverables', 'real response and payment'],
    },
    WEBSITES: {
      objective: 'Validate website projects through evidence-backed prospects and small demos.',
      steps: ['identify weak/missing digital presence', 'verify business', 'research local price evidence', 'build a focused demo', 'send offer manually', 'deliver and measure payment'],
      humanActions: ['review demo', 'send offer', 'collect content', 'approve deployment', 'record payment'],
      evidenceToCollect: ['website quality evidence', 'business contact', 'market price sources', 'demo', 'payment/outcome'],
    },
    WHATSAPP_BOTS: {
      objective: 'Find businesses with repetitive WhatsApp/customer-service work and validate a small automation.',
      steps: ['find repeated questions or lead-handling friction', 'map the conversation/workflow', 'prototype FAQ/lead capture flow', 'demo to the business', 'agree scope and human-approved deployment', 'measure time/enquiry outcome and payment'],
      humanActions: ['confirm the workflow', 'approve bot scope', 'contact the business', 'connect any business account', 'approve deployment'],
      evidenceToCollect: ['real FAQ/problem evidence', 'workflow map', 'demo', 'price evidence', 'client response and payment'],
    },
    AUTOMATION: {
      objective: 'Convert repetitive SME admin work into scoped automation projects.',
      steps: ['identify repeated manual task', 'document current workflow', 'estimate time/cost of problem', 'prototype automation', 'human-approved proposal', 'deploy and measure outcome'],
      humanActions: ['verify workflow', 'approve integrations', 'send proposal', 'deploy', 'confirm outcome'],
      evidenceToCollect: ['workflow evidence', 'frequency/time estimate', 'prototype', 'scope and price', 'measured result'],
    },
    CONTENT_SOCIAL: {
      objective: 'Run small content experiments and test legitimate monetization using connected performance data and actual revenue.',
      steps: ['select evidence-backed topic', 'define audience and monetization path', 'create a small batch', 'human publishes', 'measure reach/engagement/clicks', 'test a monetization path', 'record actual revenue'],
      humanActions: ['approve topic', 'create/review content', 'publish', 'respond to audience', 'approve sponsorship/affiliate terms'],
      evidenceToCollect: ['topic demand', 'platform metrics', 'traffic/click data', 'monetization terms', 'actual revenue'],
    },
    FREELANCE_REMOTE: {
      objective: 'Find legitimate remote briefs matching current skills and convert applications into paid work.',
      steps: ['search legitimate briefs', 'check client/project legitimacy', 'match skills and requirements', 'prepare tailored application', 'human submits', 'deliver work and record payment'],
      humanActions: ['verify listing', 'submit application', 'communicate with client', 'accept contract', 'deliver'],
      evidenceToCollect: ['listing URL', 'client/project identity', 'requirements match', 'application', 'contract/payment outcome'],
    },
    DIGITAL_PRODUCTS: {
      objective: 'Package a repeated problem into a small reusable product only after demand evidence.',
      steps: ['identify repeated problem', 'validate willingness to pay', 'define smallest useful product', 'build', 'human launches', 'measure sales and support cost'],
      humanActions: ['validate demand', 'approve product scope', 'publish', 'handle customers', 'record sales/costs'],
      evidenceToCollect: ['repeated problem evidence', 'price/willingness-to-pay evidence', 'product', 'sales', 'support cost'],
    },
    EDUCATION_TUTORING: {
      objective: 'Provide legitimate tutoring and study support without completing dishonest graded work for students.',
      steps: ['identify subject/demand', 'define tutoring package', 'prepare explanations/practice material', 'human delivers tutoring', 'collect payment and learning outcome'],
      humanActions: ['set scope', 'teach/tutor', 'review student work', 'collect payment'],
      evidenceToCollect: ['demand', 'subject scope', 'tutoring offer', 'payment', 'student feedback/outcome'],
    },
    AFFILIATE_REFERRAL: {
      objective: 'Test relevant referral programs only when terms, tracking and product value can be verified.',
      steps: ['find legitimate program', 'verify commission and eligibility terms', 'match product to a real audience need', 'human publishes recommendation', 'track clicks/conversions/commission'],
      humanActions: ['approve program', 'approve recommendation', 'publish', 'review terms and payouts'],
      evidenceToCollect: ['official program terms', 'tracking evidence', 'audience relevance', 'conversion/commission records'],
    },
    TRADING_RESEARCH: {
      objective: 'Evaluate Tembo/forex strategies through reproducible research and paper trading without live-money execution.',
      steps: ['define hypothesis', 'obtain market data', 'backtest without look-ahead bias', 'include realistic costs', 'paper trade', 'review risk and invalidation conditions'],
      humanActions: ['review research', 'decide whether further paper testing is warranted', 'keep live trading disabled'],
      evidenceToCollect: ['strategy rules', 'data provenance', 'backtest metrics', 'paper-trading results', 'risk-gate state'],
    },
    OTHER: {
      objective: 'Classify an emerging opportunity and test the cheapest useful evidence-backed experiment.',
      steps: ['define the problem', 'verify demand', 'estimate delivery and price', 'run a small human-approved test', 'record actual outcome'],
      humanActions: ['approve test', 'perform real-world action', 'record result'],
      evidenceToCollect: ['demand evidence', 'price/terms', 'test output', 'actual outcome'],
    },
  };

  return { channel: strategy.kind, ...plans[strategy.kind], ...common };
}
