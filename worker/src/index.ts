/* ============================================================================
 * SURVIVE AI — Cloudflare Worker entry point.
 *
 * Runs the AgentEngine headlessly against Cloudflare D1 on a cron.
 *
 *   POST /cycles/run        run one research cycle now  (header: x-trigger-secret)
 *   GET  /health            liveness + connector status
 *   GET  /status            agent snapshot (balance, status, counts)
 *   scheduled (cron)        runs one cycle every 30 minutes
 *
 * The worker holds all secrets (API keys and payment credentials) — they never
 * touch the browser. EcoCash is currently sandbox-only; real-money execution
 * remains disabled by policy and there is no autonomous payment path.
 * ========================================================================== */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AgentEngine } from '../../src/engine/agentEngine';
import { SupabaseRepository } from '../../src/engine/supabaseRepository';
import { D1Repository } from '../../src/engine/d1Repository';
import type { EngineRepository } from '../../src/engine/repository';
import type { ProspectStatus, OfferStatus, ProjectMilestoneKey, RealRevenueEntry, Opportunity, BusinessModel } from '../../src/types';
import { computeProfit, generateLearningEvent, foldRealRevenueIntoMemory, computeCategoryRealWorldStats, statsForCategory } from '../../src/lib/realRevenue';
import { researchProspect } from '../../src/services/prospectIntelligence';
import { verifyProspect } from '../../src/services/prospectVerification';
import { discoverProspects } from '../../src/services/prospectDiscovery';
import { generateProspectDemo } from '../../src/lib/demoGenerator';
import { generateDesignBrief } from '../../src/lib/designBriefGenerator';
import { generateOffer } from '../../src/lib/offerGenerator';
import { generateOutreachMessages } from '../../src/lib/outreachGenerator';
import { createLLMProvider } from '../../src/services/providers/llm';
import { createSearchProviders } from '../../src/services/providers/search';
import { balanceFrom } from '../../src/services/wallet';
import { loadEconomyState, saveEconomyState, getEconomySummary, computeSearchROI } from '../../src/services/searchEconomy';
import {
  computeRevenueFunnel,
  conversionByCategory,
  conversionByAcquisitionChannel,
  computeDealMetrics,
  openPipelineExpectedValue,
  offersAwaitingSend,
} from '../../src/lib/revenueFunnel';
import { computeSurvivalStatus } from '../../src/engine/seed';
import { computeSurvivalScore } from '../../src/lib/survivalScore';
import { buildEconomicMemory } from '../../src/lib/economicMemory';
import { computeMoneyMetrics } from '../../src/lib/moneyMetrics';
import {
  calculateTreasurySnapshot,
  authorizeSpend,
  createConfirmedExpense,
  DEFAULT_TREASURY_POLICY,
  type TreasuryPolicy,
  type SpendRequest,
} from '../../src/lib/treasury';
import type { Env } from './env';
import {
  ecoCashStatus,
  createEcoCashSandboxCharge,
  lookupEcoCashSandboxTransaction,
  verifyEcoCashWebhook,
} from './paymentProvider';
import { finivexStatus, createFinivexPaymentLink, getFinivexPaymentStatus } from './finivexProvider';
import { getWindsorIncomeSummary } from './windsorProvider';
import { INCOME_CHANNEL_STRATEGIES, decideIncomeChannel } from '../../src/lib/incomeChannelBrain';
import { buildForexResearchPackage, classifyForexSource, type ForexResearchFinding } from '../../src/lib/forexResearch';
import { runUnifiedProspectResearch } from '../../src/services/unifiedProspectResearch';


function finivexConfig(env: Env) {
  return { baseUrl: env.FINIVEX_BASE_URL ?? 'https://gateway.finivex.online/api/pg', apiKey: env.FINIVEX_API_KEY, apiSecret: env.FINIVEX_API_SECRET };
}

function windsorConfig(env: Env) {
  return {
    apiKey: env.WINDSOR_API_KEY,
    baseUrl: env.WINDSOR_BASE_URL,
    accounts: {
      searchconsole: env.WINDSOR_SEARCHCONSOLE_ACCOUNT_ID ?? 'https://nwt-dev-website.ngaatendwew.workers.dev/',
      googleanalytics4: env.WINDSOR_GA4_ACCOUNT_ID ?? '554933512',
      facebook_organic: env.WINDSOR_FACEBOOK_ACCOUNT_ID ?? '1252129927993703',
      instagram: env.WINDSOR_INSTAGRAM_ACCOUNT_ID ?? '17841472745490723',
      tiktok_organic: env.WINDSOR_TIKTOK_ACCOUNT_ID ?? '_000aVorMZyL807-8WN-eULnSn11kQPtr8yb',
      youtube: env.WINDSOR_YOUTUBE_ACCOUNT_ID ?? '43093',
      linkedin_organic: env.WINDSOR_LINKEDIN_ACCOUNT_ID,
    },
  };
}

function ecoCashConfig(env: Env) {
  return {
    baseUrl: env.ECOCASH_BASE_URL ?? 'https://developers.ecocash.co.zw',
    username: env.ECOCASH_USERNAME ?? env.ECOCASH_CLIENT_ID,
    password: env.ECOCASH_PASSWORD ?? env.ECOCASH_CLIENT_SECRET,
    merchantCode: env.ECOCASH_MERCHANT_CODE,
    merchantPin: env.ECOCASH_MERCHANT_PIN,
    merchantNumber: env.ECOCASH_MERCHANT_NUMBER,
    webhookSecret: env.ECOCASH_WEBHOOK_SECRET,
  };
}

function paymentStatusFromProvider(value: unknown): 'PENDING' | 'CONFIRMED' | 'FAILED' {
  const s = String(value ?? '').trim().toUpperCase();
  // Match provider status values as tokens rather than substring-searching
  // them. This prevents values such as "UNSUCCESSFUL" or "INCOMPLETE" from
  // being incorrectly classified as confirmed.
  const normalized = s.replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const confirmed = new Set(['SUCCESS', 'SUCCESSFUL', 'COMPLETED', 'COMPLETE', 'PAID', 'CONFIRMED']);
  const failed = new Set(['FAILED', 'FAILURE', 'REJECTED', 'DECLINED', 'CANCELLED', 'CANCELED', 'ERROR', 'UNSUCCESSFUL', 'INCOMPLETE']);
  if (confirmed.has(normalized)) return 'CONFIRMED';
  if (failed.has(normalized)) return 'FAILED';
  return 'PENDING';
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest).map((b) => b.toString(16).padStart(2, '0')).join('');
}

const OPERATOR_SESSION_TTL_MS = 8 * 60 * 60 * 1000;

async function createOperatorSession(repo: EngineRepository): Promise<{ token: string; expiresAt: number }> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = Date.now() + OPERATOR_SESSION_TTL_MS;
  const tokenHash = await sha256Hex(token);
  const raw = await repo.getKV('operator_sessions');
  let sessions: any[] = [];
  try { sessions = raw ? JSON.parse(raw) : []; } catch { sessions = []; }
  if (!Array.isArray(sessions)) sessions = [];
  const active = sessions.filter((x) => typeof x?.expiresAt === 'number' && x.expiresAt > Date.now()).slice(-49);
  active.push({ tokenHash, expiresAt });
  await repo.setKV('operator_sessions', JSON.stringify(active));
  return { token, expiresAt };
}

async function requireOperator(req: Request, env: Env): Promise<boolean> {
  if (!env.TRIGGER_SECRET) return false;
  const match = (req.headers.get('authorization') ?? '').match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;
  const tokenHash = await sha256Hex(match[1].trim());
  const { repo } = buildEngine(env);
  const raw = await repo.getKV('operator_sessions');
  if (!raw) return false;
  let sessions: any[] = [];
  try { sessions = JSON.parse(raw); } catch { return false; }
  if (!Array.isArray(sessions)) return false;
  return sessions.some((x) => x?.tokenHash === tokenHash && typeof x?.expiresAt === 'number' && x.expiresAt > Date.now());
}

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-trigger-secret, authorization',
      'access-control-max-age': '600',
      ...(init?.headers ?? {}),
    },
  });

async function hasHumanApproval(
  repo: EngineRepository,
  opts: { actionId?: string; actionKind: string; prospectId?: string },
): Promise<boolean> {
  const raw = await repo.getKV('human_action_approvals');
  let approvals: any[] = [];
  try { approvals = raw ? JSON.parse(raw) : []; } catch { approvals = []; }
  if (!Array.isArray(approvals)) return false;
  return approvals.some((a) =>
    (a?.status === 'APPROVED' || a?.status === 'EXECUTED') &&
    a?.actionKind === opts.actionKind &&
    (opts.actionId ? a?.actionId === opts.actionId : true) &&
    (opts.prospectId ? a?.prospectId === opts.prospectId : true),
  );
}

function buildEngine(env: Env): {
  engine: AgentEngine;
  repo: EngineRepository;
  tavily: import('../../src/services/providers/types').SearchProvider | null;
  brave: import('../../src/services/providers/types').SearchProvider | null;
  llm: import('../../src/services/providers/types').LLMProvider | null;
  connections: Record<string, boolean>;
} {
  const backend = env.DB_BACKEND ?? 'd1';
  const agentId = env.AGENT_ID ?? 'agent-survive-01';

  let repo: EngineRepository;
  let dbConnected: boolean;
  if (backend === 'supabase') {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('DB_BACKEND=supabase but SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are not set');
    }
    const db: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });
    repo = new SupabaseRepository(db, agentId);
    dbConnected = true;
  } else {
    if (!env.DB) throw new Error('DB_BACKEND=d1 but the DB (D1) binding is missing from wrangler.toml');
    repo = new D1Repository(env.DB, agentId);
    dbConnected = true;
  }

  const llm = createLLMProvider({
    anthropic: env.ANTHROPIC_API_KEY,
    openai: env.OPENAI_API_KEY,
  });
  const { tavily, brave } = createSearchProviders({
    tavily: env.TAVILY_API_KEY,
    brave: env.BRAVE_API_KEY,
  });

  const engine = new AgentEngine(repo, { llm, tavily, brave }, {});

  return {
    engine,
    repo,
    tavily,
    brave,
    llm,
    connections: {
      [backend]: dbConnected,
      llm: Boolean(llm?.connected),
      search: Boolean(tavily?.connected || brave?.connected),
    },
  };
}

type IncomeChannelOpportunity = {
  id: string;
  channel: string;
  title: string;
  description: string;
  evidence: string;
  sourceUrls: string[];
  discoveredAt: number;
};

const INCOME_CHANNEL_QUERIES: Record<string, string[]> = {
  'content-social': ['Zimbabwe content creator monetization opportunities 2026', 'Zimbabwe social media businesses sponsorship creator opportunities'],
  'freelance-remote': ['remote freelance web development jobs Africa Zimbabwe', 'remote junior web developer contract opportunities Africa'],
  'digital-products': ['digital products demand Zimbabwe small businesses websites templates', 'Zimbabwe small business digital services online demand'],
  'affiliate-referral': ['Zimbabwe affiliate programs technology business services', 'Africa affiliate programs web hosting software services'],
  'other': ['Zimbabwe small business technology opportunities 2026', 'Zimbabwe online business opportunities services demand 2026'],
};

async function researchIncomeChannels(env: Env, requestedChannel?: string): Promise<IncomeChannelOpportunity[]> {
  const { repo, tavily, brave } = buildEngine(env);
  const balance = balanceFrom(await repo.listTransactions());
  const survivalStatus = computeSurvivalStatus(balance);
  const state = await loadEconomyState(repo);
  const ctx = {
    state,
    providers: { tavily, brave },
    survivalStatus,
    now: Date.now(),
    cycleStartedAt: Date.now(),
  };
  const existingRaw = await repo.getKV('income_intelligence');
  const existing: IncomeChannelOpportunity[] = existingRaw ? JSON.parse(existingRaw) : [];
  const found: IncomeChannelOpportunity[] = [...existing];
  const channelEntries = requestedChannel && INCOME_CHANNEL_QUERIES[requestedChannel]
    ? [[requestedChannel, INCOME_CHANNEL_QUERIES[requestedChannel]] as [string, string[]]]
    : Object.entries(INCOME_CHANNEL_QUERIES);
  for (const [channel, queries] of channelEntries) {
    for (const query of queries) {
      const result = await (await import('../../src/services/searchEconomy')).runSearch(ctx, {
        purpose: 'OTHER',
        query,
        entityId: `income:${channel}`,
        priority: 'MEDIUM',
        max: 5,
      });
      for (const item of result.results) {
        if (!item.url || !item.title) continue;
        const id = await sha256Hex(`${channel}|${item.url}`);
        const entry: IncomeChannelOpportunity = {
          id: `inc_${id.slice(0, 20)}`,
          channel,
          title: item.title.slice(0, 180),
          description: item.snippet.slice(0, 700),
          evidence: `Found through live search for: ${query}`,
          sourceUrls: [item.url],
          discoveredAt: Date.now(),
        };
        const pos = found.findIndex((x) => x.id === entry.id);
        if (pos >= 0) found[pos] = entry; else found.push(entry);
      }
    }
  }
  ctx.state && await saveEconomyState(repo, ctx.state);
  const bounded = found.sort((a,b) => b.discoveredAt - a.discoveredAt).slice(0, 100);
  await repo.setKV('income_intelligence', JSON.stringify(bounded));
  return bounded;
}

async function runCycle(env: Env): Promise<Response> {
  const { engine, repo, connections } = buildEngine(env);
  try {
    await engine.ensureSeeded();
    const outcome = await engine.runCycle({
      useLive: true,
      stepDelay: 0, // headless: no artificial pacing
    });
    if (!outcome) {
      return json(
        { ok: false, reason: 'agent is DEAD or cycle aborted', connections },
        { status: 409 },
      );
    }
    try {
      await repo.setKV('runtime:last_cycle', JSON.stringify({
        at: new Date().toISOString(),
        cycleIndex: outcome.cycle.index,
        status: outcome.finalStatus,
        balance: outcome.balance,
      }));
    } catch (heartbeatError) {
      console.warn('[runtime] failed to persist cycle heartbeat:', (heartbeatError as Error).message);
    }

    return json({
      ok: true,
      cycleIndex: outcome.cycle.index,
      status: outcome.finalStatus,
      balance: outcome.balance,
      experiment: outcome.experiment
        ? {
            opportunity: outcome.experiment.opportunityName,
            outcome: outcome.experiment.outcome,
            cost: outcome.experiment.actualCost,
            revenue: outcome.experiment.actualRevenue,
            roi: outcome.experiment.roi,
          }
        : null,
      connections,
    });
  } catch (e) {
    return json(
      { ok: false, error: (e as Error).message, stack: (e as Error).stack?.split('\n').slice(0, 3) },
      { status: 500 },
    );
  }
}

let productionCoreTablesReady = false;

async function ensureProductionCoreTables(db: D1Database): Promise<void> {
  if (productionCoreTablesReady) return;

  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_events (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      message TEXT NOT NULL,
      data TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_memory (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      kind TEXT NOT NULL,
      ref_type TEXT,
      ref_id TEXT,
      title TEXT NOT NULL,
      tests INTEGER NOT NULL DEFAULT 0,
      spent REAL NOT NULL DEFAULT 0,
      revenue REAL NOT NULL DEFAULT 0,
      conclusion TEXT NOT NULL DEFAULT 'UNTESTED',
      notes TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS agent_cycles (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      cycle_index INTEGER NOT NULL,
      steps TEXT NOT NULL DEFAULT '[]',
      discovered_ids TEXT NOT NULL DEFAULT '[]',
      selected_opportunity_id TEXT REFERENCES opportunities(id),
      experiment_id TEXT REFERENCES experiments(id),
      summary TEXT,
      started_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS research_reports (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
      opportunity_id TEXT NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
      opportunity_name TEXT NOT NULL DEFAULT '',
      generator TEXT NOT NULL DEFAULT 'local-rule-engine',
      executive_summary TEXT NOT NULL,
      market_opportunity TEXT,
      how_it_works TEXT,
      capital_requirements TEXT,
      competition TEXT,
      risks TEXT NOT NULL DEFAULT '[]',
      evidence TEXT,
      potential_revenue TEXT,
      recommended_experiment TEXT,
      confidence REAL NOT NULL,
      final_score INTEGER NOT NULL,
      data_source TEXT NOT NULL DEFAULT 'SAMPLE',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    )`),
  ]);

  productionCoreTablesReady = true;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (env.DB_BACKEND === 'd1') await ensureProductionCoreTables(env.DB);
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-trigger-secret, authorization',
      'access-control-max-age': '600',
    } });

    if (url.pathname === '/auth/login' && req.method === 'POST') {
      try {
        const body: any = await req.json();
        if (typeof body?.secret !== 'string' || !env.TRIGGER_SECRET || body.secret !== env.TRIGGER_SECRET) {
          return json({ ok: false, error: 'unauthorized' }, { status: 401 });
        }
        const { repo } = buildEngine(env);
        const session = await createOperatorSession(repo);
        return json({ ok: true, token: session.token, expiresAt: session.expiresAt });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }


    if (url.pathname === '/integrations/windsor/summary' && req.method === 'GET') {
      try {
        const summary = await getWindsorIncomeSummary(windsorConfig(env));
        return json({ ok: true, ...summary });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/finivex/status' && req.method === 'GET') {
      return json({ ok: true, payment: finivexStatus(finivexConfig(env)) });
    }

    if (url.pathname === '/payments/requests' && req.method === 'GET') {
      try {
        const { results } = await env.DB.prepare(
          'SELECT * FROM payment_requests WHERE agent_id = ? ORDER BY created_at DESC LIMIT 100'
        ).bind(env.AGENT_ID ?? 'agent-survive-01').all();
        return json({ ok: true, requests: results });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/requests' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const clientName = typeof body?.clientName === 'string' ? body.clientName.trim() : '';
      const description = typeof body?.description === 'string' ? body.description.trim() : '';
      const amount = body?.amount;
      const currency = body?.currency === 'ZWG' ? 'ZWG' : body?.currency === 'USD' ? 'USD' : null;
      const paymentMethod = ['FINIVEX','ECOCASH','BANK','CASH','OTHER'].includes(body?.paymentMethod) ? body.paymentMethod : 'OTHER';
      if (!clientName || !description) return json({ ok: false, error: 'clientName and description are required' }, { status: 400 });
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return json({ ok: false, error: 'amount must be a positive number' }, { status: 400 });
      if (!currency) return json({ ok: false, error: 'currency must be USD or ZWG' }, { status: 400 });
      const now = new Date().toISOString();
      const id = 'payreq_' + crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO payment_requests
            (id, agent_id, client_name, amount, currency, description, payment_method, prospect_id, project_id, opportunity_id, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`
        ).bind(
          id, env.AGENT_ID ?? 'agent-survive-01', clientName, amount, currency, description, paymentMethod,
          typeof body.prospectId === 'string' ? body.prospectId : null,
          typeof body.projectId === 'string' ? body.projectId : null,
          typeof body.opportunityId === 'string' ? body.opportunityId : null,
          now, now,
        ).run();
        return json({ ok: true, request: { id, clientName, amount, currency, description, paymentMethod, status: 'PENDING', createdAt: now, updatedAt: now } });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/requests/approve' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const id = typeof body?.requestId === 'string' ? body.requestId : '';
      if (!id) return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const request = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(id).first<any>();
        if (!request) return json({ ok: false, error: 'payment request not found' }, { status: 404 });
        if (request.status !== 'PENDING') return json({ ok: false, error: `payment request is already ${request.status}` }, { status: 409 });
        const now = new Date().toISOString();
        await env.DB.prepare('UPDATE payment_requests SET status = \'APPROVED\', approved_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
        return json({ ok: true, request: { ...request, status: 'APPROVED', approved_at: now, updated_at: now } });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/requests/cancel' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const id = typeof body?.requestId === 'string' ? body.requestId : '';
      if (!id) return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const request = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(id).first<any>();
        if (!request) return json({ ok: false, error: 'payment request not found' }, { status: 404 });
        if (request.status === 'PAID') return json({ ok: false, error: 'paid payment request cannot be cancelled' }, { status: 409 });
        const now = new Date().toISOString();
        await env.DB.prepare('UPDATE payment_requests SET status = \'CANCELLED\', updated_at = ? WHERE id = ?').bind(now, id).run();
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/finivex/create-approved-link' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const id = typeof body?.requestId === 'string' ? body.requestId : '';
      if (!id) return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const request = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(id).first<any>();
        if (!request) return json({ ok: false, error: 'payment request not found' }, { status: 404 });
        if (request.payment_method !== 'FINIVEX') return json({ ok: false, error: 'payment request is not configured for Finivex' }, { status: 400 });
        if (!['APPROVED','LINK_CREATED'].includes(request.status)) return json({ ok: false, error: 'payment request must be approved before creating a payment link' }, { status: 403 });
        if (request.status === 'LINK_CREATED' && request.payment_link) return json({ ok: true, request, paymentLink: request.payment_link, note: 'Existing active payment link returned.' });
        const config = finivexConfig(env);
        if (!finivexStatus(config).configured) return json({ ok: false, error: 'Finivex credentials are not configured' }, { status: 503 });
        const result = await createFinivexPaymentLink(config, {
          amount: Number(request.amount),
          currency: request.currency,
          description: request.description,
          customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail.trim() : undefined,
          customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone.trim() : undefined,
          expiresInMinutes: typeof body.expiresInMinutes === 'number' ? Math.max(5, Math.min(10080, Math.floor(body.expiresInMinutes))) : undefined,
        });
        const provider = result.body as any;
        const data = provider?.data ?? {};
        if (!result.ok || !data.paymentLink) {
          await env.DB.prepare('UPDATE payment_requests SET status = \'FAILED\', updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
          return json({ ok: false, error: 'Finivex payment-link creation failed', provider, httpStatus: result.httpStatus }, { status: 502 });
        }
        const now = new Date().toISOString();
        const linkId = 'fl_' + crypto.randomUUID();
        const reference = data.reference ?? null;
        await env.DB.prepare(
          `INSERT INTO finivex_payment_links
           (id, agent_id, transaction_id, provider_reference, amount, currency, description, customer_email, customer_phone, payment_link, status, provider_response, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?)`
        ).bind(
          linkId, env.AGENT_ID ?? 'agent-survive-01', reference ?? linkId, reference, request.amount, request.currency, request.description,
          typeof body.customerEmail === 'string' ? body.customerEmail.trim() : null,
          typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null,
          data.paymentLink, JSON.stringify(provider), now, now,
        ).run();
        await env.DB.prepare(
          'UPDATE payment_requests SET status = \'LINK_CREATED\', finivex_link_id = ?, finivex_reference = ?, payment_link = ?, updated_at = ? WHERE id = ?'
        ).bind(linkId, reference, data.paymentLink, now, id).run();
        return json({ ok: true, requestId: id, paymentLink: data.paymentLink, reference, provider, note: 'Customer payment link created. Survivor has not moved money.' });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/requests/mark-paid' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const id = typeof body?.requestId === 'string' ? body.requestId : '';
      if (!id) return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const request = await env.DB.prepare('SELECT * FROM payment_requests WHERE id = ?').bind(id).first<any>();
        if (!request) return json({ ok: false, error: 'payment request not found' }, { status: 404 });
        if (request.status === 'PAID') return json({ ok: true, alreadyPaid: true });
        if (request.payment_method === 'FINIVEX') return json({ ok: false, error: 'Finivex payments are marked paid only after server-side provider verification' }, { status: 403 });
        const now = new Date().toISOString();
        await env.DB.prepare('UPDATE payment_requests SET status = \'PAID\', paid_at = ?, updated_at = ? WHERE id = ?').bind(now, now, id).run();
        return json({ ok: true });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/finivex/webhook' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const transactionId = typeof body?.transactionId === 'string' ? body.transactionId.trim() : '';
      if (!transactionId) return json({ ok: false, error: 'transactionId is required' }, { status: 400 });
      try {
        const config = finivexConfig(env);
        if (!finivexStatus(config).configured) return json({ ok: false, error: 'Finivex credentials are not configured' }, { status: 503 });
        const verified = await getFinivexPaymentStatus(config, transactionId);
        const provider = verified.body as any;
        const status = String(provider?.data?.status ?? body.status ?? '').toUpperCase();
        const terminal = ['COMPLETED','FAILED','CANCELLED','EXPIRED','REFUNDED'].includes(status);
        if (!verified.ok || !terminal) return json({ ok: true, accepted: true, verified: false, status }, { status: 202 });
        const mapped = status === 'COMPLETED' ? 'PAID' : status;
        const now = new Date().toISOString();
        const link = await env.DB.prepare(
          'SELECT * FROM finivex_payment_links WHERE transaction_id = ? OR provider_reference = ? LIMIT 1'
        ).bind(transactionId, transactionId).first<any>();
        if (link) {
          await env.DB.prepare(
            'UPDATE finivex_payment_links SET status = ?, provider_response = ?, updated_at = ?, paid_at = CASE WHEN ? = \'PAID\' THEN COALESCE(paid_at, ?) ELSE paid_at END WHERE id = ?'
          ).bind(mapped, JSON.stringify(provider), now, mapped, now, link.id).run();
          const reqRow = await env.DB.prepare('SELECT id FROM payment_requests WHERE finivex_link_id = ?').bind(link.id).first<any>();
          if (reqRow) {
            await env.DB.prepare(
              'UPDATE payment_requests SET status = ?, paid_at = CASE WHEN ? = \'PAID\' THEN COALESCE(paid_at, ?) ELSE paid_at END, updated_at = ? WHERE id = ?'
            ).bind(mapped, mapped, now, now, reqRow.id).run();
          }
        }
        return json({ ok: true, accepted: true, verified: true, status: mapped });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/finivex/payment-link' && req.method === 'POST') {
      const secret = req.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const amount = body?.amount;
      const currency = body?.currency === 'ZWG' ? 'ZWG' : body?.currency === 'USD' ? 'USD' : null;
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) return json({ ok: false, error: 'amount must be a positive number' }, { status: 400 });
      if (!currency) return json({ ok: false, error: 'currency must be USD or ZWG' }, { status: 400 });
      const config = finivexConfig(env);
      if (!finivexStatus(config).configured) return json({ ok: false, error: 'Finivex credentials are not configured' }, { status: 503 });
      try {
        const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : 'NWT Dev payment';
        const result = await createFinivexPaymentLink(config, {
          amount, currency, description,
          customerEmail: typeof body.customerEmail === 'string' ? body.customerEmail.trim() : undefined,
          customerPhone: typeof body.customerPhone === 'string' ? body.customerPhone.trim() : undefined,
          redirectUrl: typeof body.redirectUrl === 'string' ? body.redirectUrl : undefined,
          expiresInMinutes: typeof body.expiresInMinutes === 'number' ? Math.max(5, Math.min(10080, Math.floor(body.expiresInMinutes))) : undefined,
        });
        const provider = result.body as any;
        const data = provider?.data ?? {};
        const now = new Date().toISOString();
        await env.DB.prepare("INSERT INTO finivex_payment_links (id, agent_id, transaction_id, provider_reference, amount, currency, description, customer_email, customer_phone, payment_link, status, provider_response, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind('fl_' + crypto.randomUUID(), env.AGENT_ID ?? 'agent-survive-01', data.reference ?? ('fl_' + Date.now()), data.reference ?? data.orderId ?? null, amount, currency, description, typeof body.customerEmail === 'string' ? body.customerEmail.trim() : null, typeof body.customerPhone === 'string' ? body.customerPhone.trim() : null, data.paymentLink ?? null, result.ok ? 'ACTIVE' : 'FAILED', JSON.stringify(provider), now, now).run();
        return json({ ok: result.ok, transactionId: data.reference ?? null, paymentLink: data.paymentLink ?? null, provider, httpStatus: result.httpStatus, note: 'Payment-link creation does not move money. The customer must complete payment.' }, { status: result.ok ? 200 : 502 });
      } catch (e) { return json({ ok: false, error: (e as Error).message }, { status: 500 }); }
    }

    if (url.pathname === '/payments/finivex/payment-status' && req.method === 'GET') {
      const secret = req.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      const transactionId = url.searchParams.get('transactionId')?.trim() ?? '';
      if (!transactionId) return json({ ok: false, error: 'transactionId is required' }, { status: 400 });
      try {
        const config = finivexConfig(env);
        if (!finivexStatus(config).configured) return json({ ok: false, error: 'Finivex credentials are not configured' }, { status: 503 });
        const result = await getFinivexPaymentStatus(config, transactionId);
        const provider = result.body as any;
        const status = String(provider?.data?.status ?? '').toUpperCase();
        const mapped = status === 'COMPLETED' ? 'PAID' : ['FAILED','CANCELLED','EXPIRED','REFUNDED'].includes(status) ? status : 'ACTIVE';
        const now = new Date().toISOString();
        await env.DB.prepare("UPDATE finivex_payment_links SET status = ?, provider_response = ?, updated_at = ?, paid_at = CASE WHEN ? = 'PAID' THEN COALESCE(paid_at, ?) ELSE paid_at END WHERE transaction_id = ?")
          .bind(mapped, JSON.stringify(provider), now, mapped, now, transactionId).run();
        return json({ ok: result.ok, transactionId, status: mapped, provider, httpStatus: result.httpStatus });
      } catch (e) { return json({ ok: false, error: (e as Error).message }, { status: 500 }); }
    }

    if (url.pathname === '/payments/status' && req.method === 'GET') {
      return json({
        ok: true,
        payment: ecoCashStatus(ecoCashConfig(env)),
      });
    }

    if (url.pathname === '/payments/ecocash/sandbox-charge' && req.method === 'POST') {
      const secret = req.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const amount = body?.amount;
      const endUserId = typeof body?.endUserId === 'string' ? body.endUserId.trim() : '';
      const description = typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : 'Survivor AI sandbox test';
      if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount > 50) {
        return json({ ok: false, error: 'sandbox amount must be a positive number no greater than 50' }, { status: 400 });
      }
      if (!endUserId) return json({ ok: false, error: 'endUserId is required (use a whitelisted EcoCash sandbox number)' }, { status: 400 });

      const config = ecoCashConfig(env);
      const status = ecoCashStatus(config);
      if (!status.configured || status.mode !== 'SANDBOX') {
        return json({ ok: false, error: 'EcoCash sandbox credentials are not configured' }, { status: 503 });
      }

      try {
        const { repo } = buildEngine(env);
        const now = Date.now();
        const id = 'pay_' + crypto.randomUUID();
        const clientCorrelator = 'SURVIVE-' + now + '-' + crypto.randomUUID().slice(0, 8);
        const referenceCode = 'SURVIVE-' + now;
        const notifyUrl = url.origin + '/payments/ecocash/webhook';

        await env.DB.prepare(
          `INSERT INTO payment_intents
             (id, agent_id, provider, direction, amount, currency, description, end_user_id,
              client_correlator, reference_code, status, notify_url, created_at, updated_at)
           VALUES (?, ?, 'ECOCASH', 'INBOUND', ?, 'USD', ?, ?, ?, ?, 'CREATED', ?, ?, ?)`
        ).bind(id, env.AGENT_ID ?? 'agent-survive-01', amount, description, endUserId, clientCorrelator, referenceCode, notifyUrl, new Date(now).toISOString(), new Date(now).toISOString()).run();

        const result = await createEcoCashSandboxCharge(config, {
          clientCorrelator,
          referenceCode,
          endUserId,
          amount,
          currency: 'USD',
          description,
          notifyUrl,
        });

        const responseBody = result.body as any;
        const providerStatus = responseBody?.transactionOperationStatus ?? responseBody?.status ?? null;
        const paymentStatus = paymentStatusFromProvider(providerStatus);
        await env.DB.prepare(
          `UPDATE payment_intents
             SET external_id = COALESCE(?, external_id),
                 provider_status = ?, provider_response = ?, status = ?, updated_at = ?
             WHERE id = ?`
        ).bind(
          responseBody?.id != null ? String(responseBody.id) : null,
          providerStatus ? String(providerStatus) : null,
          JSON.stringify(responseBody),
          paymentStatus,
          new Date().toISOString(),
          id,
        ).run();

        return json({
          ok: result.ok,
          sandbox: true,
          paymentIntentId: id,
          clientCorrelator,
          referenceCode,
          httpStatus: result.httpStatus,
          provider: responseBody,
          note: 'Sandbox only. No real money was moved by Survivor-AI.',
        }, { status: result.ok ? 200 : 502 });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }


    if (url.pathname === '/payments/ecocash/sandbox-lookup' && req.method === 'GET') {
      const secret = req.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }

      const endUserId = url.searchParams.get('endUserId')?.trim() ?? '';
      const clientCorrelator = url.searchParams.get('clientCorrelator')?.trim() ?? '';
      if (!endUserId || !clientCorrelator) {
        return json(
          { ok: false, error: 'endUserId and clientCorrelator are required' },
          { status: 400 },
        );
      }

      try {
        const config = ecoCashConfig(env);
        const status = ecoCashStatus(config);
        if (!status.configured || status.mode !== 'SANDBOX') {
          return json({ ok: false, error: 'EcoCash sandbox credentials are not configured' }, { status: 503 });
        }

        const result = await lookupEcoCashSandboxTransaction(
          config,
          endUserId,
          clientCorrelator,
        );

        return json({
          ok: result.ok,
          sandbox: true,
          endUserId,
          clientCorrelator,
          httpStatus: result.httpStatus,
          provider: result.body,
          note: 'Lookup only. Survivor-AI does not move money from this endpoint.',
        }, { status: result.ok ? 200 : 502 });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/payments/ecocash/webhook' && req.method === 'POST') {
      const rawBody = await req.text();
      if (!await verifyEcoCashWebhook(rawBody, req.headers, env.ECOCASH_WEBHOOK_SECRET)) {
        return json({ ok: false, error: 'invalid webhook signature' }, { status: 401 });
      }

      let body: any;
      try { body = JSON.parse(rawBody); } catch { return json({ ok: false, error: 'invalid JSON webhook payload' }, { status: 400 }); }

      try {
        const { repo } = buildEngine(env);
        const externalEventId = String(body?.id ?? body?.eventId ?? body?.transactionId ?? body?.serverReferenceCode ?? body?.referenceCode ?? await sha256Hex(rawBody));
        const payloadHash = await sha256Hex(rawBody);
        const insertEvent = await env.DB.prepare(
          `INSERT OR IGNORE INTO payment_provider_events
             (id, provider, external_event_id, event_type, signature_verified, payload_hash, payload_json, status, received_at)
           VALUES (?, 'ECOCASH', ?, 'WEBHOOK', 1, ?, ?, 'RECEIVED', ?)`
        ).bind('pevt_' + externalEventId, externalEventId, payloadHash, rawBody, new Date().toISOString()).run();

        if (insertEvent.meta.changes === 0) {
          return json({ ok: true, duplicate: true });
        }

        const referenceCode = String(body?.referenceCode ?? body?.clientCorrelator ?? '');
        const externalId = body?.id != null ? String(body.id) : null;
        const intent = await env.DB.prepare(
          `SELECT * FROM payment_intents
           WHERE reference_code = ? OR client_correlator = ? OR (? IS NOT NULL AND external_id = ?)
           ORDER BY created_at DESC LIMIT 1`
        ).bind(referenceCode, referenceCode, externalId, externalId).first<any>();

        if (!intent) {
          await env.DB.prepare(
            `UPDATE payment_provider_events SET status = 'UNMATCHED', processed_at = ? WHERE external_event_id = ?`
          ).bind(new Date().toISOString(), externalEventId).run();
          return json({ ok: true, matched: false });
        }

        const providerStatus = body?.transactionOperationStatus ?? body?.status ?? body?.transactionStatus ?? '';
        const paymentStatus = paymentStatusFromProvider(providerStatus);
        await env.DB.prepare(
          `UPDATE payment_intents
             SET external_id = COALESCE(?, external_id),
                 provider_status = ?, provider_response = ?, status = ?,
                 updated_at = ?, confirmed_at = CASE WHEN ? = 'CONFIRMED' THEN ? ELSE confirmed_at END
             WHERE id = ?`
        ).bind(
          externalId,
          String(providerStatus),
          rawBody,
          paymentStatus,
          new Date().toISOString(),
          paymentStatus,
          new Date().toISOString(),
          intent.id,
        ).run();

        // EcoCash sandbox transactions are simulated test events. They must
        // never become REVENUE in the economic ledger. A sandbox confirmation
        // only reconciles payment/provider ledgers; real revenue is recorded
        // separately by the human after an actual production payment.
        if (paymentStatus === 'CONFIRMED') {
          await env.DB.prepare(
            `UPDATE payment_provider_events SET event_type = 'SANDBOX_PAYMENT_CONFIRMED' WHERE external_event_id = ?`
          ).bind(externalEventId).run();
        }

        await env.DB.prepare(
          `UPDATE payment_provider_events SET status = 'PROCESSED', processed_at = ? WHERE external_event_id = ?`
        ).bind(new Date().toISOString(), externalEventId).run();

        return json({ ok: true, matched: true, paymentIntentId: intent.id, status: paymentStatus });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/health') {
      const backend = env.DB_BACKEND ?? 'd1';
      let lastCycle: Record<string, unknown> | null = null;
      let schemaReady = true;
      let missingTables: string[] = [];
      try {
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('runtime:last_cycle');
        if (raw) lastCycle = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Health remains liveness-first: an unavailable heartbeat should not
        // turn the Worker into a 500 response.
      }
      if (backend === 'd1' && env.DB) {
        try {
          const requiredTables = [
            'agents',
            'opportunities',
            'experiments',
            'transactions',
            'agent_events',
            'strategies',
            'agent_memory',
            'agent_cycles',
            'research_reports',
            'missions',
            'kv_store',
            'payment_intents',
            'payment_provider_events',
          ];
          const placeholders = requiredTables.map(() => '?').join(',');
          const rows = await env.DB
            .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`)
            .bind(...requiredTables)
            .all<{ name: string }>();
          const found = new Set(rows.results.map((row) => row.name));
          missingTables = requiredTables.filter((name) => !found.has(name));
          schemaReady = missingTables.length === 0;
        } catch {
          schemaReady = false;
          missingTables = ['schema-check-failed'];
        }
      }
      const lastCycleAt = typeof lastCycle?.at === 'string' ? Date.parse(lastCycle.at) : NaN;
      const ageMinutes = Number.isFinite(lastCycleAt) ? Math.max(0, (Date.now() - lastCycleAt) / 60000) : null;
      return json({
        ok: true,
        ready: schemaReady,
        schema: { ready: schemaReady, missingTables },
        service: 'survive-ai',
        deployment: {
          commit: env.BUILD_SHA ?? null,
        },
        time: new Date().toISOString(),
        runtime: {
          cronConfigured: true,
          cronSchedule: '*/30 * * * *',
          timezone: 'UTC',
          lastCycle,
          lastCycleAgeMinutes: ageMinutes === null ? null : Math.round(ageMinutes * 10) / 10,
          stale: ageMinutes !== null ? ageMinutes > 75 : null,
        },
        connectors: {
          db: { backend, connected: backend === 'supabase' ? Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) : Boolean(env.DB) },
          llm: Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY),
          search: Boolean(env.TAVILY_API_KEY || env.BRAVE_API_KEY),
          payments: {
            sandboxConfigured: ecoCashStatus(ecoCashConfig(env)).configured,
            finivexConfigured: finivexStatus(finivexConfig(env)).configured,
            productionExecutionEnabled: false,
          },
        },
      });
    }

    if (url.pathname === '/status') {
      try {
        const { repo } = buildEngine(env);
        const agent = await repo.getAgent();
        const [opps, exps, txs, events] = await Promise.all([
          repo.listOpportunities(),
          repo.listExperiments(),
          repo.listTransactions(),
          repo.listEvents(),
        ]);
        const balance = balanceFrom(txs);
        return json({
          ok: true,
          agent: {
            id: agent.id,
            status: agent.status,
            balance,
            startingCapital: agent.startingCapital,
            survivalThreshold: agent.survivalThreshold,
            cyclesRun: agent.totalCyclesRun,
            strategy: agent.currentStrategy,
            objective: agent.currentObjective,
          },
          counts: {
            opportunities: opps.length,
            liveOpportunities: opps.filter((o) => o.dataSource === 'LIVE').length,
            experiments: exps.length,
            events: events.length,
          },
          lastEvents: events.slice(-8).map((e) => ({ at: e.createdAt, type: e.type, message: e.message })),
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/state') {
      // Full read-only mirror of backend/D1 state for the dashboard — this is
      // what fixes the frontend/backend disconnect: the browser renders
      // exactly this payload instead of inventing its own local state.
      // No secrets are ever included here; it is the same simulated
      // business data /status already summarizes, just unabridged.
      try {
        const { repo } = buildEngine(env);
        const agent = await repo.getAgent();
        const [
          opportunities,
          experiments,
          transactions,
          memory,
          events,
          cycles,
          reports,
          strategies,
          businessModels,
          decisions,
          actions,
          prospects,
          prospectInteractions,
          outreachMessages,
          offers,
          designBriefs,
          projects,
          realRevenue,
          learningEvents,
          prospectIntelligence,
          prospectDemos,
          marketPriceResearch,
          missions,
        ] = await Promise.all([
          repo.listOpportunities(),
          repo.listExperiments(),
          repo.listTransactions(),
          repo.listMemory(),
          repo.listEvents(),
          repo.listCycles(),
          repo.listReports(),
          repo.listStrategies(),
          repo.listBusinessModels(),
          repo.listDecisions(),
          repo.listActions(),
          repo.listProspects(),
          repo.listProspectInteractions(),
          repo.listOutreachMessages(),
          repo.listOffers(),
          repo.listDesignBriefs(),
          repo.listProjects(),
          repo.listRealRevenue(),
          repo.listLearningEvents(),
          repo.listProspectIntelligence(),
          repo.listProspectDemos(),
          repo.listMarketPriceResearch(),
          repo.listMissions(),
        ]);

        // Economic Survival Overhaul (Phases 6/14/15) — search-cost
        // economics, revenue funnel and search ROI, computed fresh from the
        // same data above rather than a separately-drifting cache.
        const balance = balanceFrom(transactions);
        const survivalStatus = computeSurvivalStatus(balance);
        const survivalScore = computeSurvivalScore(balance, agent.startingCapital, prospects, transactions);
        const economyState = await loadEconomyState(repo);
        const searchEconomy = getEconomySummary(economyState, survivalStatus);
        const funnel = computeRevenueFunnel(prospects, realRevenue);
        const dealMetrics = computeDealMetrics(realRevenue);
        const searchROI = computeSearchROI({
          totalFreshSearches: searchEconomy.searchesToday, // today's window — see docs for why "today" is the ROI denominator
          prospectsGenerated: prospects.length,
          qualifiedProspects: prospects.filter((p) => p.status !== 'DISCOVERED').length,
          repliesRecorded: prospects.filter((p) => ['REPLIED', 'INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON'].includes(p.status)).length,
          proposalsSent: offers.filter((o) => o.status !== 'DRAFT').length,
          wins: prospects.filter((p) => p.status === 'WON').length,
          realRevenueTotal: dealMetrics.avgDealSize !== null ? realRevenue.reduce((s, r) => s + r.amountReceived, 0) : 0,
          expectedValueOfOpenPipeline: openPipelineExpectedValue(prospects),
        });
        const approvalRaw = await repo.getKV('human_action_approvals');
        let actionApprovals: unknown[] = [];
        try { actionApprovals = approvalRaw ? JSON.parse(approvalRaw) : []; } catch { actionApprovals = []; }
        const humanActionQueue = {
          topAction: actions[0] ?? null,
          queue: actions,
          offersAwaitingSend: offersAwaitingSend(offers),
          followUpsDue: prospects.filter((p) => p.nextFollowUpAt && p.nextFollowUpAt <= Date.now()).length,
          prospectsNeedingStatusUpdate: prospects.filter(
            (p) => p.status === 'CONTACTED' && p.lastContactAt && Date.now() - p.lastContactAt > 3 * 24 * 60 * 60 * 1000,
          ).length,
          wonWithoutRecordedPayment: prospects.filter(
            (p) => p.status === 'WON' && !realRevenue.some((r) => r.prospectId === p.id),
          ).length,
        };
        const incomeRaw = await repo.getKV('income_intelligence');
        let incomeIntelligence: unknown[] = [];
        try { incomeIntelligence = incomeRaw ? JSON.parse(incomeRaw) : []; } catch { incomeIntelligence = []; }

        const moneyMetrics = computeMoneyMetrics(prospects, offers, realRevenue);

        return json({
          ok: true,
          fetchedAt: new Date().toISOString(),
          agent,
          survivalScore,
          actionApprovals,
          economicEfficiency: {
            searchEconomy,
            revenueFunnel: funnel,
            conversionByCategory: conversionByCategory(prospects, opportunities),
            conversionByAcquisitionChannel: conversionByAcquisitionChannel(realRevenue),
            dealMetrics,
            searchROI,
            humanActionQueue,
            moneyMetrics,
            survivalStatus,
          },
          opportunities,
          experiments,
          transactions,
          memory,
          // Bounded so the payload can never grow unbounded over the agent's
          // lifetime — the dashboard only needs recent history to render.
          events: events.slice(-300),
          cycles: cycles.slice(-150),
          reports,
          strategies,
          // Commercial core (build-spec §3/§5/§16).
          businessModels,
          decisions: decisions.slice(0, 200),
          actions,
          // Real-world pipeline (build-spec §7/§8/§9).
          prospects,
          prospectInteractions: prospectInteractions.slice(0, 300),
          outreachMessages,
          // Offer + delivery (Phase 3).
          offers,
          designBriefs,
          projects,
          // Real revenue + feedback learning (Phase 4).
          realRevenue,
          learningEvents: learningEvents.slice(0, 300),
          // Deep research on specific businesses (Phase 6).
          prospectIntelligence,
          // Real, working demo pages (Phase 3, deepened) — metadata only;
          // the full HTML is served at GET /demo/{prospectId} so this
          // payload stays bounded regardless of how many demos exist.
          prospectDemos: prospectDemos.map(({ html, ...meta }) => meta),
          // Real market pricing research (replaces the old formula guess).
          marketPriceResearch,
          // Survivor 2.0 §10 — the structured mission ladder.
          missions,
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/income/strategy' && req.method === 'POST') {
      try {
        let body: any = {};
        try { body = await req.json(); } catch { body = {}; }

        const requested = typeof body?.channel === 'string' ? body.channel.trim() : '';
        const strategies = requested
          ? INCOME_CHANNEL_STRATEGIES.filter((s) => s.kind === requested)
          : INCOME_CHANNEL_STRATEGIES;

        if (requested && strategies.length === 0) {
          return json({ ok: false, error: 'unknown income channel' }, { status: 400 });
        }

        const { repo, tavily, brave } = buildEngine(env);
        const entries = await repo.listRealRevenue();
        const memory = buildEconomicMemory(entries);
        const state = await loadEconomyState(repo);
        const ctx = {
          state,
          providers: { tavily, brave },
          survivalStatus: computeSurvivalStatus(balanceFrom(await repo.listTransactions())),
          now: Date.now(),
          cycleStartedAt: Date.now(),
        };

        const evidence: Array<{ channel: string; title: string; description: string; sourceUrls: string[] }> = [];
        const strategiesOut: Array<any> = [];
        const channelPlans: Array<any> = [];

        // One live demand query per channel keeps this human-triggered endpoint
        // bounded while still grounding every strategy in fresh evidence.
        for (const strategy of strategies) {
          const query = strategy.demandQueries[0];
          let searchResultCount = 0;
          if (query) {
            const result = await (await import('../../src/services/searchEconomy')).runSearch(ctx, {
              purpose: 'OTHER',
              query,
              entityId: `income-strategy:${strategy.kind}`,
              priority: strategy.kind === 'TRADING_RESEARCH' ? 'HIGH' : 'MEDIUM',
              max: 5,
            });
            searchResultCount = result.results.length;
            for (const item of result.results.slice(0, 5)) {
              if (!item.url || !item.title) continue;
              evidence.push({
                channel: strategy.kind,
                title: item.title.slice(0, 180),
                description: item.snippet.slice(0, 700),
                sourceUrls: [item.url],
              });
            }
          }

          const decision = decideIncomeChannel(strategy, memory, entries);
          const plan = (await import('../../src/lib/incomeChannelBrain')).buildIncomeExecutionPlan(strategy, memory, entries);
          strategiesOut.push({
            kind: strategy.kind,
            name: strategy.name,
            category: strategy.category,
            lifecycle: decision.lifecycle,
            marketId: strategy.marketId,
            customer: strategy.customer,
            problemToSolve: strategy.problemToSolve,
            delivery: strategy.delivery,
            requiredHumanAction: strategy.requiredHumanAction,
            risk: strategy.risk,
            testCost: strategy.testCost,
            nextExperiment: decision.nextExperiment,
            searchResultCount,
            decision,
          });
          channelPlans.push({ kind: strategy.kind, decision, plan });
        }

        // Forex gets a dedicated evidence package because it has stricter
        // research-only guardrails than ordinary income channels.
        const forexQueries = INCOME_CHANNEL_STRATEGIES.find((s) => s.kind === 'TRADING_RESEARCH')?.demandQueries ?? [];
        const forexFindings: ForexResearchFinding[] = [];
        for (const query of forexQueries.slice(0, 4)) {
          const result = await (await import('../../src/services/searchEconomy')).runSearch(ctx, {
            purpose: 'OTHER',
            query,
            entityId: 'income-strategy:TRADING_RESEARCH',
            priority: 'HIGH',
            max: 5,
          });
          for (const item of result.results) {
            if (!item.url || !item.title) continue;
            forexFindings.push({
              query,
              title: item.title.slice(0, 180),
              snippet: item.snippet.slice(0, 700),
              sourceUrl: item.url,
              sourceType: classifyForexSource(query, item.title),
            });
          }
        }

        await saveEconomyState(repo, ctx.state);
        const forex = buildForexResearchPackage(forexFindings);

        return json({
          ok: true,
          generatedAt: new Date().toISOString(),
          strategies: strategiesOut,
          evidence: evidence.slice(0, 80),
          channelPlans,
          forex,
          guardrails: {
            autonomousTrading: false,
            autonomousPublishing: false,
            autonomousOutreach: false,
            autonomousPayments: false,
            academicDishonesty: false,
          },
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/actions/approvals' && req.method === 'GET') {
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      try {
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('human_action_approvals');
        const approvals = raw ? JSON.parse(raw) : [];
        return json({ ok: true, approvals: Array.isArray(approvals) ? approvals.slice(-200) : [] });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/actions/approvals' && req.method === 'POST') {
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      try {
        const body: any = await req.json();
        if (typeof body?.actionId !== 'string' || typeof body?.actionKind !== 'string' || typeof body?.title !== 'string') {
          return json({ ok: false, error: 'actionId, actionKind and title are required' }, { status: 400 });
        }
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('human_action_approvals');
        const approvals: any[] = raw ? JSON.parse(raw) : [];
        const existing = approvals.find((a) => a.actionId === body.actionId && a.status === 'PENDING');
        if (existing) return json({ ok: true, approval: existing });
        const approval = {
          id: 'approval_' + crypto.randomUUID(),
          actionId: body.actionId,
          actionKind: body.actionKind,
          title: body.title.trim(),
          prospectId: typeof body.prospectId === 'string' ? body.prospectId : undefined,
          opportunityId: typeof body.opportunityId === 'string' ? body.opportunityId : undefined,
          status: 'PENDING',
          createdAt: Date.now(),
        };
        approvals.push(approval);
        await repo.setKV('human_action_approvals', JSON.stringify(approvals.slice(-200)));
        return json({ ok: true, approval });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/actions/approvals/review' && req.method === 'POST') {
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      try {
        const body: any = await req.json();
        if (typeof body?.approvalId !== 'string' || !['APPROVED', 'REJECTED'].includes(body?.decision)) {
          return json({ ok: false, error: 'approvalId and decision are required' }, { status: 400 });
        }
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('human_action_approvals');
        const approvals: any[] = raw ? JSON.parse(raw) : [];
        const approval = approvals.find((a) => a.id === body.approvalId);
        if (!approval) return json({ ok: false, error: 'approval not found' }, { status: 404 });
        if (approval.status !== 'PENDING') return json({ ok: false, error: 'approval is already reviewed' }, { status: 409 });
        approval.status = body.decision;
        approval.reviewedAt = Date.now();
        if (typeof body.note === 'string') approval.note = body.note;
        await repo.setKV('human_action_approvals', JSON.stringify(approvals));
        return json({ ok: true, approval });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/actions/approvals/execute' && req.method === 'POST') {
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      try {
        const body: any = await req.json();
        if (typeof body?.approvalId !== 'string') return json({ ok: false, error: 'approvalId is required' }, { status: 400 });
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('human_action_approvals');
        const approvals: any[] = raw ? JSON.parse(raw) : [];
        const approval = approvals.find((a) => a.id === body.approvalId);
        if (!approval) return json({ ok: false, error: 'approval not found' }, { status: 404 });
        if (approval.status !== 'APPROVED') return json({ ok: false, error: 'only approved actions can be marked executed' }, { status: 409 });
        approval.status = 'EXECUTED';
        approval.executedAt = Date.now();
        await repo.setKV('human_action_approvals', JSON.stringify(approvals));
        return json({ ok: true, approval });
      } catch (e) { return json({ ok: false, error: (e as Error).message }, { status: 500 }); }
    }

    if (url.pathname === '/content/state' && req.method === 'GET') {
      try {
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('content_engine_state');
        const state = raw ? JSON.parse(raw) : { version: 1, researchedAt: null, research: [], drafts: [] };
        return json({ ok: true, state });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/content/state' && req.method === 'POST') {
      try {
        const body: any = await req.json();
        if (!body || typeof body !== 'object') {
          return json({ ok: false, error: 'invalid content state' }, { status: 400 });
        }
        const research = Array.isArray(body.research) ? body.research.slice(0, 100) : [];
        const drafts = Array.isArray(body.drafts) ? body.drafts.slice(0, 100) : [];
        const state = {
          version: 1,
          researchedAt: typeof body.researchedAt === 'number' ? body.researchedAt : null,
          research,
          drafts,
          updatedAt: Date.now(),
        };
        const { repo } = buildEngine(env);
        await repo.setKV('content_engine_state', JSON.stringify(state));
        return json({ ok: true, state });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/income/research' && req.method === 'POST') {
      try {
        let body: any = {};
        try { body = await req.json(); } catch { body = {}; }
        const requestedChannel = typeof body?.channel === 'string' ? body.channel : undefined;
        if (requestedChannel && !INCOME_CHANNEL_QUERIES[requestedChannel]) {
          return json({ ok: false, error: `unsupported income channel: ${requestedChannel}` }, { status: 400 });
        }
        const opportunities = await researchIncomeChannels(env, requestedChannel);
        return json({ ok: true, opportunities, researchedAt: new Date().toISOString() });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/prospects/discover' && req.method === 'POST') {
      if (!(await requireOperator(req, env))) {
        return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      }
      // Immediate operator-triggered real business discovery.
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const requestedOpportunityId = typeof body?.opportunityId === 'string' ? body.opportunityId : undefined;
      const region = typeof body?.region === 'string' && body.region.trim() ? body.region.trim() : undefined;
      const searchQuery = typeof body?.searchQuery === 'string' && body.searchQuery.trim() ? body.searchQuery.trim() : undefined;
      try {
        const { repo, tavily, brave } = buildEngine(env);
        if (!tavily?.connected && !brave?.connected) return json({ ok: false, error: 'no live search provider connected — connect Tavily or Brave before discovering real businesses' }, { status: 503 });
        const opportunities = (await repo.listOpportunities()).filter((o) => o.researchStage !== 'UNDISCOVERED');
        const directAcquisitionOpportunity: Opportunity = {
          id: 'nwt-dev-local-business-acquisition',
          name: 'NWT Dev — Local Business Website & Digital Services',
          category: 'Services',
          tags: ['NWT Dev', 'websites', 'local-business', 'client-acquisition'],
          dataSource: 'LIVE',
          researchStage: 'VERIFIED',
          description: 'Direct operator acquisition campaign for finding real Zimbabwean businesses that may need websites or digital services.',
          howMoneyMade: 'Sell scoped website and digital-service projects to businesses after human review and outreach.',
          capitalRequiredMin: 0,
          capitalRequiredMax: 50,
          timeToRevenueDaysMin: 1,
          timeToRevenueDaysMax: 30,
          skills: ['web development', 'sales', 'client communication'],
          difficulty: 2,
          competition: 3,
          scalability: 3,
          risk: 1,
          riskLevel: 'Low',
          geographicRelevance: ['Zimbabwe'],
          evidenceTier: 'VERIFIED',
          evidenceNotes: 'Operator-defined acquisition campaign. Individual businesses and contacts must still be verified from public sources.',
          successProbability: 0,
          revenuePotentialMonthlyMin: 0,
          revenuePotentialMonthlyMax: 0,
          upsideNote: 'Actual revenue depends on real client conversions.',
          downsideNote: 'Search results may be incomplete or ambiguous.',
          operatingCostsNote: 'Search/API costs only; no automatic outreach or payment execution.',
          examples: [],
          sources: [],
          dateResearched: null,
          executionBlocked: false,
          lifecycleState: 'VALIDATING',
        };
        const directAcquisitionModel: BusinessModel = {
          id: 'nwt-dev-local-business-acquisition-model',
          opportunityId: directAcquisitionOpportunity.id,
          opportunityName: directAcquisitionOpportunity.name,
          targetCustomer: 'Zimbabwean local businesses that need a stronger website or digital presence',
          problem: 'Potential customers may have limited, outdated, or fragmented online presence.',
          offer: 'a professional, mobile-friendly business website and digital presence setup',
          whyTheyBuy: 'A clear online presence can make business information easier for prospective customers to find and contact.',
          suggestedPrice: 150,
          priceRationale: 'Starting price for a small first website engagement; final price depends on agreed scope.',
          deliveryCostEstimate: 0,
          expectedGrossMarginPct: 100,
          acquisitionChannel: 'Verified public business contacts found through live web research',
          salesMessage: 'Offer a concise, evidence-based website improvement proposal after reviewing the business presence.',
          followUpSequence: ['Initial human-reviewed outreach', 'Follow up after a few days if appropriate', 'Stop if the business declines'],
          objectionHandling: [{ objection: 'Price is too high', response: 'Offer a smaller first scope rather than inventing a discount or changing the facts.' }],
          deliveryWorkflow: 'Verify business → research presence → prepare offer/demo → human outreach → agree scope → deliver → record real payment.',
          timeToFirstSaleDaysEstimate: 14,
          upsells: ['Maintenance and support', 'Content updates', 'Booking/contact integrations'],
          recurringRevenueNote: 'Optional maintenance/support can be discussed after the initial project.',
          expectedProfitFirstDeal: 150,
          canScale: true,
          scaleNote: 'Repeatable prospect research and standardized website delivery can support more clients.',
          nextAction: 'Find and verify local businesses matching the operator-selected search query.',
          confidence: 1,
          generator: 'local-rule-engine',
          generatedAt: Date.now(),
          updatedAt: Date.now(),
        };
        const opportunity = requestedOpportunityId
          ? opportunities.find((o) => o.id === requestedOpportunityId)
          : directAcquisitionOpportunity;
        if (!opportunity) return json({ ok: false, error: 'selected opportunity not found' }, { status: 404 });
        if (opportunity.id === directAcquisitionOpportunity.id) {
          await repo.upsertOpportunities([directAcquisitionOpportunity]);
          await repo.upsertBusinessModel(directAcquisitionModel);
        }
        const models = await repo.listBusinessModels();
        const model = models.find((m) => m.opportunityId === opportunity.id);
        const existing = await repo.listProspects();
        const existingNames = existing.filter((p) => p.opportunityId === opportunity.id).map((p) => p.businessName);
        const balance = balanceFrom(await repo.listTransactions());
        const state = await loadEconomyState(repo);
        const now = Date.now();
        const ctx = { state, providers: { tavily, brave }, survivalStatus: computeSurvivalStatus(balance), now, cycleStartedAt: now };
        const discovered = await discoverProspects(ctx, opportunity, model, existingNames, undefined, now, { region, searchQuery });
        const accepted: typeof discovered.prospects = [];
        for (const raw of discovered.prospects) {
          const verified = await verifyProspect(ctx, raw, now);
          if (verified.verification?.status === 'UNVERIFIED' || verified.verification?.status === 'CONFLICT') continue;
          accepted.push(verified);
        }
        if (accepted.length) {
          await repo.upsertProspects(accepted);
          for (const p of accepted) await repo.appendProspectInteraction({ id: 'pint_' + crypto.randomUUID(), prospectId: p.id, kind: 'DISCOVERED', summary: 'Operator-triggered live discovery + identity verification: ' + (p.verification?.status ?? 'UNVERIFIED') + ' (' + (p.verification?.confidence ?? 0) + '% confidence).', createdAt: now });
        }
        await saveEconomyState(repo, ctx.state);
        return json({ ok: true, opportunityId: opportunity.id, opportunityName: opportunity.name, directAcquisitionMode: opportunity.id === 'nwt-dev-local-business-acquisition', region: region || opportunity.geographicRelevance[0] || 'Zimbabwe', searchQuery: searchQuery || null, discovered: discovered.prospects.length, verified: accepted.length, rejectedUnverifiedOrConflicting: discovered.prospects.length - accepted.length, queriesRun: discovered.queriesRun, sourcesCount: discovered.sourcesCount, cacheHits: discovered.cacheHits, budgetExceeded: discovered.budgetExceeded, prospects: accepted });
      } catch (e) { return json({ ok: false, error: (e as Error).message }, { status: 500 }); }
    }
    if (url.pathname === '/offers/generate' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const prospectId = typeof body?.prospectId === 'string' ? body.prospectId : '';
      if (!prospectId) return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      try {
        const { repo } = buildEngine(env);
        const [prospects, offers, models, intelligence, pricing] = await Promise.all([
          repo.listProspects(), repo.listOffers(), repo.listBusinessModels(), repo.listProspectIntelligence(), repo.listMarketPriceResearch(),
        ]);
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });
        if (!['VERIFIED', 'PROVISIONAL'].includes(prospect.verification?.status ?? '')) {
          return json({ ok: false, error: 'offer generation requires VERIFIED or PROVISIONAL prospect verification' }, { status: 409 });
        }
        if (offers.some((o) => o.prospectId === prospectId)) {
          return json({ ok: false, error: 'an offer already exists for this prospect' }, { status: 409 });
        }
        const model = models.find((m) => m.opportunityId === prospect.opportunityId);
        const intel = intelligence.find((i) => i.prospectId === prospectId);
        const marketPrice = pricing.find((p) => p.opportunityId === prospect.opportunityId);
        const offer = generateOffer(prospect, model, intel, marketPrice);
        await repo.upsertOffer(offer);
        const brief = generateDesignBrief(offer, prospect);
        await repo.upsertDesignBrief(brief);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`, prospectId, kind: 'OFFER_DRAFTED',
          summary: 'Offer and design brief generated on demand for human review.', createdAt: Date.now(),
        });
        return json({ ok: true, offer, designBrief: brief, approvalAction: { actionId: `offer:${offer.id}`, actionKind: 'SEND_OFFER', title: `Review and send offer to ${prospect.businessName}`, prospectId } });
      } catch (e) { return json({ ok: false, error: (e as Error).message }, { status: 500 }); }
    }

    if (url.pathname === '/outreach/generate' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      const prospectId = typeof body?.prospectId === 'string' ? body.prospectId : '';
      if (!prospectId) return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      try {
        const { repo } = buildEngine(env);
        const [prospects, outreach, models, intelligence] = await Promise.all([
          repo.listProspects(), repo.listOutreachMessages(), repo.listBusinessModels(), repo.listProspectIntelligence(),
        ]);
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });
        if (!['VERIFIED', 'PROVISIONAL'].includes(prospect.verification?.status ?? '')) {
          return json({ ok: false, error: 'outreach generation requires VERIFIED or PROVISIONAL prospect verification' }, { status: 409 });
        }
        if (outreach.some((o) => o.prospectId === prospectId)) {
          return json({ ok: false, error: 'outreach already exists for this prospect' }, { status: 409 });
        }
        const model = models.find((m) => m.opportunityId === prospect.opportunityId);
        const intel = intelligence.find((i) => i.prospectId === prospectId);
        const messages = generateOutreachMessages(prospect, model, intel);
        await repo.upsertOutreachMessages(messages);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`, prospectId, kind: 'OUTREACH_GENERATED',
          summary: 'Outreach message set generated on demand for human review; nothing was sent.', createdAt: Date.now(),
        });
        return json({ ok: true, outreach: messages, approvalAction: { actionId: `outreach:${prospectId}`, actionKind: 'CONTACT_PROSPECT', title: `Review and contact ${prospect.businessName}`, prospectId } });
      } catch (e) { return json({ ok: false, error: (e as Error).message }, { status: 500 }); }
    }

    if (url.pathname === '/prospects/status' && req.method === 'POST') {
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      // The CRM write path (Phase 3, carried forward from the original
      // build spec): a human records a real-world outcome for a prospect.
      // Narrow and unauthenticated like the rest of this single-operator
      // system — touches only the prospects table, never wallet/experiment
      // data. This is the only way a prospect ever advances past
      // QUALIFIED, since SURVIVE AI never contacts anyone or observes real
      // replies itself.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { prospectId, status, reasonLost } = body ?? {};
      const VALID_STATUSES = new Set([
        'DISCOVERED',
        'QUALIFIED',
        'CONTACTED',
        'REPLIED',
        'INTERESTED',
        'PROPOSAL_SENT',
        'NEGOTIATING',
        'WON',
        'LOST',
        'NOT_INTERESTED',
        'FOLLOW_UP',
      ]);
      if (typeof prospectId !== 'string' || !prospectId) {
        return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      }
      if (typeof status !== 'string' || !VALID_STATUSES.has(status)) {
        return json({ ok: false, error: `status must be one of: ${[...VALID_STATUSES].join(', ')}` }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        const prospects = await repo.listProspects();
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });

        const current = prospect.status;
        const verificationReady =
          prospect.verification?.status === 'VERIFIED' ||
          prospect.verification?.status === 'PROVISIONAL';
        const hasVerifiedContact = Boolean(
          prospect.verification?.verifiedContactValue || prospect.verification?.verifiedEmail,
        );
        const offers = await repo.listOffers();
        const offer = offers.find((o) => o.prospectId === prospectId);
        const offerSent = offer?.status === 'SENT' || offer?.status === 'ACCEPTED';
        if (status === 'PROPOSAL_SENT' && offer && !await hasHumanApproval(repo, { actionId: `offer:${offer.id}`, actionKind: 'SEND_OFFER', prospectId })) {
          return json({ ok: false, error: 'Human approval is required before recording a sent proposal.' }, { status: 403 });
        }

        // Server-side evidence gates prevent the CRM from claiming progress that
        // the stored evidence cannot support. Human confirmation is still required.
        if ((status === 'CONTACTED' || status === 'FOLLOW_UP') && !await hasHumanApproval(repo, { actionId: `outreach:${prospectId}`, actionKind: 'CONTACT_PROSPECT', prospectId })) {
          return json({ ok: false, error: 'Human approval is required before recording CONTACTED or FOLLOW_UP for this prospect.' }, { status: 403 });
        }
        if (status === 'CONTACTED' && (!verificationReady || !hasVerifiedContact)) {
          return json({
            ok: false,
            error: 'Cannot mark contacted: the prospect needs VERIFIED/PROVISIONAL identity evidence and a verified public contact first.',
          }, { status: 409 });
        }
        if (status === 'REPLIED' && !['CONTACTED', 'REPLIED', 'FOLLOW_UP'].includes(current)) {
          return json({ ok: false, error: `Cannot mark replied from ${current}: record a real CONTACTED state first.` }, { status: 409 });
        }
        if (status === 'INTERESTED' && !['REPLIED', 'INTERESTED', 'FOLLOW_UP'].includes(current)) {
          return json({ ok: false, error: `Cannot mark interested from ${current}: record a real REPLIED state first.` }, { status: 409 });
        }
        if (status === 'PROPOSAL_SENT' && !offerSent) {
          return json({ ok: false, error: 'Cannot mark proposal sent: the linked offer must first be recorded as SENT.' }, { status: 409 });
        }
        if (status === 'NEGOTIATING' && !['INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING'].includes(current)) {
          return json({ ok: false, error: `Cannot mark negotiating from ${current}: record interest or a sent proposal first.` }, { status: 409 });
        }
        if (status === 'FOLLOW_UP' && !['CONTACTED', 'REPLIED', 'INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'FOLLOW_UP'].includes(current)) {
          return json({ ok: false, error: `Cannot mark follow-up from ${current}: contact the prospect first.` }, { status: 409 });
        }
        if (status === 'QUALIFIED' && !['DISCOVERED', 'QUALIFIED'].includes(current)) {
          return json({ ok: false, error: `Cannot mark qualified from ${current}: qualification must follow discovery.` }, { status: 409 });
        }
        if (status === 'WON' && current === 'DISCOVERED') {
          return json({ ok: false, error: 'Cannot mark a never-contacted prospect as won.' }, { status: 409 });
        }

        await repo.updateProspectStatus(prospectId, status as ProspectStatus, typeof reasonLost === 'string' ? reasonLost : undefined);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'STATUS_CHANGE',
          summary: `Status updated from ${current} to ${status} by operator.${reasonLost ? ` Reason: ${reasonLost}` : ''}`,
          createdAt: Date.now(),
        });
        return json({ ok: true, prospectId, status });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/prospects/verify' && req.method === 'POST') {
      // Human-triggered identity/contact consolidation. Searches independent
      // public sources and persists the result; ambiguous contacts are never
      // promoted into the CRM contact field.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { prospectId } = body ?? {};
      if (typeof prospectId !== 'string' || !prospectId) {
        return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      }
      try {
        const { repo, tavily, brave } = buildEngine(env);
        if (!tavily?.connected && !brave?.connected) {
          return json({ ok: false, error: 'no live search provider connected — nothing real to verify' }, { status: 503 });
        }
        const prospects = await repo.listProspects();
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });

        const now = Date.now();
        const balance = balanceFrom(await repo.listTransactions());
        const state = await loadEconomyState(repo);
        const ctx = {
          state,
          providers: { tavily, brave },
          survivalStatus: computeSurvivalStatus(balance),
          now,
          cycleStartedAt: now,
        };
        const verified = await verifyProspect(ctx, prospect, now);
        await saveEconomyState(repo, ctx.state);
        await repo.upsertProspects([verified]);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'NOTE',
          summary: `Manual identity/contact verification: ${verified.verification?.status ?? 'UNVERIFIED'} (${verified.verification?.confidence ?? 0}% confidence), ${verified.verification?.independentSources ?? 0} independent source(s), ${verified.verification?.contactSources ?? 0} contact source(s).`,
          createdAt: now,
        });
        return json({ ok: true, prospect: verified });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/prospects/research/full' && req.method === 'POST') {
      // Unified Research Engine: identity -> business intelligence -> market pricing.
      let body: any;
      try { body = await req.json(); } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { prospectId } = body ?? {};
      if (typeof prospectId !== 'string' || !prospectId) {
        return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      }
      try {
        const { repo, tavily, brave, llm } = buildEngine(env);
        if (!tavily?.connected && !brave?.connected) {
          return json({ ok: false, error: 'no live search provider connected — nothing real to research' }, { status: 503 });
        }
        const prospects = await repo.listProspects();
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });
        const opportunities = await repo.listOpportunities();
        const opportunity = opportunities.find((o) => o.id === prospect.opportunityId);
        if (!opportunity) return json({ ok: false, error: 'linked opportunity not found' }, { status: 404 });

        const now = Date.now();
        const balance = balanceFrom(await repo.listTransactions());
        const state = await loadEconomyState(repo);
        const ctx = {
          state,
          providers: { tavily, brave },
          survivalStatus: computeSurvivalStatus(balance),
          now,
          cycleStartedAt: now,
        };

        const packageResult = await runUnifiedProspectResearch(ctx, llm, prospect, opportunity, now);
        await repo.upsertProspects([packageResult.prospect]);
        await repo.upsertProspectIntelligence(packageResult.intelligence);
        await repo.upsertMarketPriceResearch(packageResult.marketPrice);
        await saveEconomyState(repo, ctx.state);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'INTELLIGENCE_GATHERED',
          summary: `Unified research completed: identity + business intelligence + market pricing; ${packageResult.sources.length} unique source(s), ${packageResult.overallConfidence.toLowerCase()} overall confidence.`,
          createdAt: now,
        });
        return json({ ok: true, ...packageResult });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/prospects/research' && req.method === 'POST') {
      // Phase 6 — manually trigger deep research on one specific prospect
      // right now, rather than waiting for the capped per-cycle automatic
      // pass. Same researchProspect() function the cycle uses; requires
      // live search to be connected, since there's nothing real to
      // research otherwise.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { prospectId } = body ?? {};
      if (typeof prospectId !== 'string' || !prospectId) {
        return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      }
      try {
        const { repo, tavily, brave, llm } = buildEngine(env);
        if (!tavily?.connected && !brave?.connected) {
          return json({ ok: false, error: 'no live search provider connected — nothing real to research' }, { status: 503 });
        }
        const prospects = await repo.listProspects();
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });

        // A human explicitly asked for this — treat it like a status change
        // (justified refresh) so it isn't silently deferred by the
        // LOW_VALUE_DEFERRED gate that protects the automatic cycle.
        const now = Date.now();
        const balance = balanceFrom(await repo.listTransactions());
        const state = await loadEconomyState(repo);
        const ctx = {
          state,
          providers: { tavily, brave },
          survivalStatus: computeSurvivalStatus(balance),
          now,
          cycleStartedAt: now,
        };
        // Manual deep research starts with identity/contact consolidation so
        // the research is performed against the best-supported business name,
        // location and public contact rather than an unverified discovery label.
        const verified = await verifyProspect(ctx, prospect, now);
        await repo.upsertProspects([verified]);

        const intel = await researchProspect(ctx, llm, verified, now, { statusChanged: true });
        await saveEconomyState(repo, ctx.state);
        await repo.upsertProspectIntelligence(intel);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'INTELLIGENCE_GATHERED',
          summary: `Identity consolidated then deep research completed manually (${intel.generator === 'llm' ? 'AI-synthesized' : 'raw source digest'}, ${intel.confidence.toLowerCase()} confidence) — ${intel.sources.length} source(s) reviewed.`,
          createdAt: Date.now(),
        });
        return json({ ok: true, prospect: verified, intelligence: intel });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname.startsWith('/demo/') && req.method === 'GET') {
      // Serve the actual, working demo page for one prospect as real HTML
      // — this is the shareable link sent to a real business ("here's
      // what your website could look like"), not a JSON API response.
      const prospectId = url.pathname.slice('/demo/'.length);
      if (!prospectId) return new Response('Not found', { status: 404 });
      try {
        const { repo } = buildEngine(env);
        const demos = await repo.listProspectDemos();
        const demo = demos.find((d) => d.prospectId === prospectId);
        if (!demo) return new Response('No demo found for this prospect yet.', { status: 404 });
        return new Response(demo.html, {
          headers: { 'content-type': 'text/html; charset=utf-8' },
        });
      } catch (e) {
        return new Response(`Error loading demo: ${(e as Error).message}`, { status: 500 });
      }
    }

    if (url.pathname === '/prospects/demo' && req.method === 'POST') {
      // Manually regenerate a prospect's demo page right now — e.g. after
      // fresh deep research or an updated offer. Requires an existing
      // offer for this prospect (the demo is built from the offer's
      // website brief); nothing to build a demo from otherwise.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { prospectId } = body ?? {};
      if (typeof prospectId !== 'string' || !prospectId) {
        return json({ ok: false, error: 'prospectId is required' }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        const [prospects, offers, intelligence] = await Promise.all([
          repo.listProspects(),
          repo.listOffers(),
          repo.listProspectIntelligence(),
        ]);
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });
        const offer = offers.find((o) => o.prospectId === prospectId);
        if (!offer) return json({ ok: false, error: 'no offer exists for this prospect yet — the demo is built from the offer\'s website brief' }, { status: 404 });
        const intel = intelligence.find((i) => i.prospectId === prospectId);

        const demo = generateProspectDemo(prospect, offer, intel);
        await repo.upsertProspectDemo(demo);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'DEMO_BUILT',
          summary: `Demo page regenerated manually (${demo.generator === 'llm' ? 'personalized from deep research' : 'standard layout'}).`,
          createdAt: Date.now(),
        });
        const { html, ...meta } = demo;
        return json({ ok: true, demo: meta, demoUrl: `${url.origin}/demo/${prospectId}` });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/offers/status' && req.method === 'POST') {
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      // Same pattern as /prospects/status — a human marks a drafted offer
      // sent/accepted/declined. Never called autonomously.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { offerId, status } = body ?? {};
      const VALID = new Set(['DRAFT', 'SENT', 'ACCEPTED', 'DECLINED']);
      if (typeof offerId !== 'string' || !offerId) {
        return json({ ok: false, error: 'offerId is required' }, { status: 400 });
      }
      if (typeof status !== 'string' || !VALID.has(status)) {
        return json({ ok: false, error: `status must be one of: ${[...VALID].join(', ')}` }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        if (status === 'SENT') {
          const offers = await repo.listOffers();
          const offer = offers.find((o) => o.id === offerId);
          if (!offer) return json({ ok: false, error: `no offer found with id ${offerId}` }, { status: 404 });
          if (!await hasHumanApproval(repo, { actionId: `offer:${offerId}`, actionKind: 'SEND_OFFER', prospectId: offer.prospectId })) {
            return json({ ok: false, error: 'Human approval is required before an offer can be marked SENT.' }, { status: 403 });
          }
        }
        await repo.updateOfferStatus(offerId, status as OfferStatus);
        return json({ ok: true, offerId, status });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/projects/milestone' && req.method === 'POST') {
      // Same pattern — a human advances a delivery project's milestone.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { projectId, milestone } = body ?? {};
      const VALID = new Set(['KICKOFF', 'CONTENT_COLLECTED', 'DESIGN_APPROVED', 'BUILD', 'REVIEW', 'DELIVERED']);
      if (typeof projectId !== 'string' || !projectId) {
        return json({ ok: false, error: 'projectId is required' }, { status: 400 });
      }
      if (typeof milestone !== 'string' || !VALID.has(milestone)) {
        return json({ ok: false, error: `milestone must be one of: ${[...VALID].join(', ')}` }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        await repo.advanceProjectMilestone(projectId, milestone as ProjectMilestoneKey);
        return json({ ok: true, projectId, milestone });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/real-revenue' && req.method === 'POST') {
      // Real revenue is the first-dollar challenge's ground truth. Only an
      // authenticated operator may append an entry; unauthenticated writes
      // would let a caller manufacture revenue and invalidate the experiment.
      if (!(await requireOperator(req, env))) return json({ ok: false, error: 'operator authentication required' }, { status: 401 });
      // The real-money write path (Phase 4, §13): a human records what
      // actually happened after a real transaction. Append-only — this
      // handler only ever inserts, never updates or deletes an entry, and
      // never touches the simulated wallet/experiment tables. Immediately
      // generates one learning event (§17) comparing prediction to actual
      // and folds a note into agent_memory — feedback happens the moment
      // the entry is recorded, not on the next cron cycle.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const {
        opportunityId,
        prospectId,
        projectId,
        productService,
        quotedPrice,
        amountReceived,
        costs,
        currency,
        paymentMethod,
        acquisitionChannel,
        daysFromDiscoveryToPayment,
        notes,
        date,
      } = body ?? {};

      const VALID_METHODS = new Set(['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD', 'OTHER']);
      const missing = ['opportunityId', 'prospectId', 'projectId', 'productService'].filter(
        (k) => typeof body?.[k] !== 'string' || !body[k],
      );
      if (missing.length) {
        return json({ ok: false, error: `missing/invalid required field(s): ${missing.join(', ')}` }, { status: 400 });
      }
      if (typeof amountReceived !== 'number' || amountReceived < 0) {
        return json({ ok: false, error: 'amountReceived must be a non-negative number' }, { status: 400 });
      }
      if (paymentMethod !== undefined && !VALID_METHODS.has(paymentMethod)) {
        return json({ ok: false, error: `paymentMethod must be one of: ${[...VALID_METHODS].join(', ')}` }, { status: 400 });
      }

      try {
        const { repo } = buildEngine(env);
        const [opportunities, businessModels, memory, prospects] = await Promise.all([
          repo.listOpportunities(),
          repo.listBusinessModels(),
          repo.listMemory(),
          repo.listProspects(),
        ]);
        const opp = opportunities.find((o) => o.id === opportunityId);
        if (!opp) return json({ ok: false, error: `no opportunity found with id ${opportunityId}` }, { status: 404 });
        const model = businessModels.find((m) => m.opportunityId === opportunityId);

        const now = Date.now();
        const profit = computeProfit(amountReceived, typeof costs === 'number' ? costs : 0);
        const entry: RealRevenueEntry = {
          id: `rr_${crypto.randomUUID()}`,
          date: typeof date === 'number' ? date : now,
          opportunityId,
          opportunityName: opp.name,
          prospectId,
          prospectName: typeof body?.prospectName === 'string' ? body.prospectName : '',
          projectId,
          productService,
          quotedPrice: typeof quotedPrice === 'number' ? quotedPrice : 0,
          amountReceived,
          costs: typeof costs === 'number' ? costs : 0,
          profit,
          currency: typeof currency === 'string' && currency ? currency : 'USD',
          paymentMethod: paymentMethod ?? 'OTHER',
          acquisitionChannel: typeof acquisitionChannel === 'string' ? acquisitionChannel : '',
          daysFromDiscoveryToPayment: typeof daysFromDiscoveryToPayment === 'number' ? daysFromDiscoveryToPayment : 0,
          notes: typeof notes === 'string' ? notes : undefined,
          createdAt: now,
        };
        await repo.addRealRevenueEntry(entry);

        const learningEvent = generateLearningEvent(entry, opp, model, now);
        await repo.appendLearningEvent(learningEvent);

        // Phase 5 §19 — include this real entry when computing the
        // category's running conversion-rate stats, so the memory note
        // reflects it immediately rather than lagging one entry behind.
        const categoryStats = statsForCategory(
          computeCategoryRealWorldStats(opportunities, prospects, [...(await repo.listRealRevenue())]),
          opp.category,
        );
        const updatedMemory = foldRealRevenueIntoMemory(memory, entry, opp, categoryStats, now);
        for (const m of updatedMemory) {
          if (!memory.includes(m)) await repo.upsertMemory(m);
        }

        return json({ ok: true, entry, learningEvent });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/projects/outcome' && req.method === 'POST') {
      // Real-world outcome tracking (Phase 4, §15) — satisfaction, repeat
      // purchase, referral. Optional fields, filled in whenever known.
      let body: any;
      try {
        body = await req.json();
      } catch {
        return json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
      }
      const { projectId, satisfaction, repeatPurchase, referral } = body ?? {};
      if (typeof projectId !== 'string' || !projectId) {
        return json({ ok: false, error: 'projectId is required' }, { status: 400 });
      }
      if (satisfaction !== undefined && (typeof satisfaction !== 'number' || satisfaction < 1 || satisfaction > 5)) {
        return json({ ok: false, error: 'satisfaction must be a number 1-5' }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        await repo.updateProjectOutcome(projectId, {
          satisfaction: typeof satisfaction === 'number' ? satisfaction : undefined,
          repeatPurchase: typeof repeatPurchase === 'boolean' ? repeatPurchase : undefined,
          referral: typeof referral === 'boolean' ? referral : undefined,
        });
        return json({ ok: true, projectId });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury' && req.method === 'GET') {
      try {
        const { repo } = buildEngine(env);
        const transactions = await repo.listTransactions();
        const rawPolicy = await repo.getKV('treasury:policy');
        const policy: TreasuryPolicy = rawPolicy ? { ...DEFAULT_TREASURY_POLICY, ...JSON.parse(rawPolicy) } : DEFAULT_TREASURY_POLICY;
        const rawRequests = await repo.getKV('treasury:spend-requests');
        const requests: SpendRequest[] = rawRequests ? JSON.parse(rawRequests) : [];
        return json({ ok: true, treasury: calculateTreasurySnapshot(transactions, policy), spendRequests: requests.slice(-100) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury/record-capital' && req.method === 'POST') {
      // Human records money already allocated to Survivor's operating budget.
      // This is accounting only: no bank/EcoCash/Finivex transfer is initiated.
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      if (typeof body?.amount !== 'number' || !Number.isFinite(body.amount) || body.amount <= 0) {
        return json({ ok: false, error: 'amount must be a positive number' }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        const transactions = await repo.listTransactions();
        const balanceBefore = transactions.reduce((sum, tx) => sum + tx.amount, 0);
        const tx = {
          id: `tx_${crypto.randomUUID()}`,
          type: 'DEPOSIT' as const,
          amount: body.amount,
          description: `[TREASURY CAPITAL] ${typeof body.description === 'string' && body.description.trim() ? body.description.trim() : 'Operating budget allocated to Survivor'}`,
          balanceAfter: balanceBefore + body.amount,
          createdAt: Date.now(),
        };
        await repo.appendTransaction(tx);
        await repo.appendEvent({
          id: `evt_${crypto.randomUUID()}`,
          type: 'WALLET',
          message: `Treasury capital recorded: ${body.amount.toFixed(2)}. No transfer was initiated by Survivor.`,
          createdAt: Date.now(),
        });
        const rawPolicy = await repo.getKV('treasury:policy');
        const policy: TreasuryPolicy = rawPolicy ? { ...DEFAULT_TREASURY_POLICY, ...JSON.parse(rawPolicy) } : DEFAULT_TREASURY_POLICY;
        return json({ ok: true, transaction: tx, treasury: calculateTreasurySnapshot(await repo.listTransactions(), policy) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury/policy' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      try {
        const { repo } = buildEngine(env);
        const currentRaw = await repo.getKV('treasury:policy');
        const current: TreasuryPolicy = currentRaw ? { ...DEFAULT_TREASURY_POLICY, ...JSON.parse(currentRaw) } : DEFAULT_TREASURY_POLICY;
        const next: TreasuryPolicy = {
          ...current,
          ...(typeof body?.protectedReserve === 'number' ? { protectedReserve: Math.max(0, body.protectedReserve) } : {}),
          ...(typeof body?.autonomousDailyLimit === 'number' ? { autonomousDailyLimit: Math.max(0, body.autonomousDailyLimit) } : {}),
          ...(typeof body?.autonomousPerTransactionLimit === 'number' ? { autonomousPerTransactionLimit: Math.max(0, body.autonomousPerTransactionLimit) } : {}),
          ...(typeof body?.approvalPerTransactionLimit === 'number' ? { approvalPerTransactionLimit: Math.max(0, body.approvalPerTransactionLimit) } : {}),
          ...(Array.isArray(body?.allowedVendors) ? { allowedVendors: body.allowedVendors.filter((v: unknown) => typeof v === 'string') } : {}),
          ...(Array.isArray(body?.blockedCategories) ? { blockedCategories: body.blockedCategories.filter((v: unknown) => typeof v === 'string') } : {}),
          realMoneyExecutionEnabled: false,
          ...(typeof body?.emergencyFrozen === 'boolean' ? { emergencyFrozen: body.emergencyFrozen } : {}),
        };
        await repo.setKV('treasury:policy', JSON.stringify(next));
        return json({ ok: true, policy: next });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury/spend-request' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      if (typeof body?.vendor !== 'string' || typeof body?.purpose !== 'string' || typeof body?.category !== 'string' || typeof body?.amount !== 'number') {
        return json({ ok: false, error: 'vendor, purpose, category and numeric amount are required' }, { status: 400 });
      }
      try {
        const { repo } = buildEngine(env);
        const transactions = await repo.listTransactions();
        const rawPolicy = await repo.getKV('treasury:policy');
        const policy: TreasuryPolicy = rawPolicy ? { ...DEFAULT_TREASURY_POLICY, ...JSON.parse(rawPolicy) } : DEFAULT_TREASURY_POLICY;
        const snapshot = calculateTreasurySnapshot(transactions, policy);
        const request: SpendRequest = {
          id: `spend_${crypto.randomUUID()}`,
          vendor: body.vendor.trim(),
          amount: body.amount,
          purpose: body.purpose.trim(),
          category: body.category.trim(),
          opportunityId: typeof body.opportunityId === 'string' ? body.opportunityId : undefined,
          expectedRevenue: typeof body.expectedRevenue === 'number' ? body.expectedRevenue : undefined,
          maxLoss: typeof body.maxLoss === 'number' ? body.maxLoss : undefined,
          evidence: typeof body.evidence === 'string' ? body.evidence : undefined,
          decision: authorizeSpend({ vendor: body.vendor, amount: body.amount, category: body.category }, snapshot),
          status: 'PENDING',
          createdAt: Date.now(),
        };
        if (request.decision === 'BLOCKED') request.status = 'REJECTED';
        const raw = await repo.getKV('treasury:spend-requests');
        const requests: SpendRequest[] = raw ? JSON.parse(raw) : [];
        requests.push(request);
        await repo.setKV('treasury:spend-requests', JSON.stringify(requests.slice(-500)));
        await repo.appendEvent({
          id: `evt_${crypto.randomUUID()}`,
          type: 'WALLET',
          message: `Treasury spend request ${request.id}: ${request.decision} — ${request.amount.toFixed(2)} to ${request.vendor}`,
          createdAt: Date.now(),
        });
        return json({ ok: true, request, treasury: snapshot });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury/spend-request/approve' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      if (typeof body?.requestId !== 'string' || !body.requestId) return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('treasury:spend-requests');
        const requests: SpendRequest[] = raw ? JSON.parse(raw) : [];
        const request = requests.find((r) => r.id === body.requestId);
        if (!request) return json({ ok: false, error: 'spend request not found' }, { status: 404 });
        if (request.status === 'RECORDED') return json({ ok: false, error: 'spend request is already recorded' }, { status: 409 });
        if (request.status === 'REJECTED' || request.decision === 'BLOCKED') return json({ ok: false, error: 'blocked/rejected spend cannot be approved' }, { status: 403 });
        if (request.status !== 'PENDING') return json({ ok: false, error: `spend request is already ${request.status}` }, { status: 409 });
        request.status = 'APPROVED';
        request.reviewedAt = Date.now();
        request.note = typeof body.note === 'string' ? body.note : request.note;
        await repo.setKV('treasury:spend-requests', JSON.stringify(requests));
        await repo.appendEvent({
          id: `evt_${crypto.randomUUID()}`,
          type: 'WALLET',
          message: `Treasury spend approved for human payment: ${request.amount.toFixed(2)} to ${request.vendor}. Survivor will not execute the payment.`,
          createdAt: Date.now(),
        });
        return json({ ok: true, request });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury/spend-request/reject' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      if (typeof body?.requestId !== 'string' || !body.requestId) return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('treasury:spend-requests');
        const requests: SpendRequest[] = raw ? JSON.parse(raw) : [];
        const request = requests.find((r) => r.id === body.requestId);
        if (!request) return json({ ok: false, error: 'spend request not found' }, { status: 404 });
        if (request.status === 'RECORDED') return json({ ok: false, error: 'recorded spend cannot be rejected' }, { status: 409 });
        request.status = 'REJECTED';
        request.reviewedAt = Date.now();
        request.note = typeof body.note === 'string' ? body.note : request.note;
        await repo.setKV('treasury:spend-requests', JSON.stringify(requests));
        await repo.appendEvent({
          id: `evt_${crypto.randomUUID()}`,
          type: 'WALLET',
          message: `Treasury spend rejected: ${request.amount.toFixed(2)} to ${request.vendor}.`,
          createdAt: Date.now(),
        });
        return json({ ok: true, request });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/treasury/record-confirmed-expense' && req.method === 'POST') {
      let body: any;
      try { body = await req.json(); } catch { return json({ ok: false, error: 'invalid JSON body' }, { status: 400 }); }
      if (typeof body?.requestId !== 'string') return json({ ok: false, error: 'requestId is required' }, { status: 400 });
      try {
        const { repo } = buildEngine(env);
        const raw = await repo.getKV('treasury:spend-requests');
        const requests: SpendRequest[] = raw ? JSON.parse(raw) : [];
        const request = requests.find((r) => r.id === body.requestId);
        if (!request) return json({ ok: false, error: 'spend request not found' }, { status: 404 });
        if (request.decision === 'BLOCKED' || request.status === 'REJECTED') return json({ ok: false, error: 'blocked/rejected spend cannot be recorded' }, { status: 403 });
        if (request.status === 'RECORDED') return json({ ok: false, error: 'spend request is already recorded' }, { status: 409 });
        if (request.status !== 'APPROVED') return json({ ok: false, error: 'spend request must be approved before recording payment' }, { status: 403 });
        const tx = createConfirmedExpense(request, await repo.listTransactions());
        await repo.appendTransaction(tx);
        request.status = 'RECORDED';
        await repo.setKV('treasury:spend-requests', JSON.stringify(requests));
        await repo.appendEvent({
          id: `evt_${crypto.randomUUID()}`,
          type: 'WALLET',
          message: `Confirmed expense recorded for ${request.vendor}: ${request.amount.toFixed(2)}. No payment was initiated by Survivor.`,
          createdAt: Date.now(),
        });
        return json({ ok: true, transaction: tx, treasury: calculateTreasurySnapshot(await repo.listTransactions()) });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/cycles/run' && req.method === 'POST') {
      const secret = req.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      return runCycle(env);
    }

    // Serve the Vite dashboard from the same Worker after API routes are handled.
    // Unknown browser paths fall back to index.html so the SPA remains navigable.
    if (req.method === 'GET' && env.ASSETS) {
      const assetResponse = await env.ASSETS.fetch(req);
      if (assetResponse.status !== 404) return assetResponse;
      if (req.headers.get('accept')?.includes('text/html')) {
        const indexRequest = new Request(new URL('/index.html', req.url), req);
        return env.ASSETS.fetch(indexRequest);
      }
    }

    return json({ ok: false, error: 'not found' }, { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The cron fires regardless of agent status; runCycle no-ops safely if DEAD.
    ctx.waitUntil(
      (async () => {
        try {
          const { engine, repo } = buildEngine(env);
          await engine.ensureSeeded();
          const outcome = await engine.runCycle({ useLive: true, stepDelay: 0 });
          if (outcome) {
            try {
              await repo.setKV('runtime:last_cycle', JSON.stringify({
                at: new Date().toISOString(),
                cycleIndex: outcome.cycle.index,
                status: outcome.finalStatus,
                balance: outcome.balance,
                trigger: 'cron',
              }));
            } catch (heartbeatError) {
              console.warn('[cron] heartbeat write failed:', (heartbeatError as Error).message);
            }
          }
          console.log(
            outcome
              ? `[cron] cycle ${outcome.cycle.index} complete — status ${outcome.finalStatus}, balance ${outcome.balance.toFixed(2)}`
              : '[cron] no cycle executed (agent unavailable/dead or cycle lock not acquired)',
          );
        } catch (e) {
          console.error('[cron] cycle failed:', (e as Error).message);
        }
      })(),
    );
  },
};