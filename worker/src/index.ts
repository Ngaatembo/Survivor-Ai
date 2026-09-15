/* ============================================================================
 * SURVIVE AI — Cloudflare Worker entry point.
 *
 * Runs the SAME AgentEngine as the browser, against Supabase, on a cron.
 *
 *   POST /cycles/run        run one research cycle now  (header: x-trigger-secret)
 *   GET  /health            liveness + connector status
 *   GET  /status            agent snapshot (balance, status, counts)
 *   scheduled (cron)        runs one cycle every 30 minutes
 *
 * The worker holds all secrets (service role key, API keys) — they never
 * touch the browser. Real-money providers are intentionally absent.
 * ========================================================================== */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AgentEngine } from '../../src/engine/agentEngine';
import { SupabaseRepository } from '../../src/engine/supabaseRepository';
import { D1Repository } from '../../src/engine/d1Repository';
import type { EngineRepository } from '../../src/engine/repository';
import type { ProspectStatus, OfferStatus, ProjectMilestoneKey, RealRevenueEntry } from '../../src/types';
import { computeProfit, generateLearningEvent, foldRealRevenueIntoMemory, computeCategoryRealWorldStats, statsForCategory } from '../../src/lib/realRevenue';
import { researchProspect } from '../../src/services/prospectIntelligence';
import { createLLMProvider } from '../../src/services/providers/llm';
import { createSearchProvider } from '../../src/services/providers/search';
import { balanceFrom } from '../../src/services/wallet';
import type { Env } from './env';

const json = (data: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(data, null, 2), {
    ...init,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'content-type, x-trigger-secret',
      ...(init?.headers ?? {}),
    },
  });

function buildEngine(env: Env): {
  engine: AgentEngine;
  repo: EngineRepository;
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
  const search = createSearchProvider({
    tavily: env.TAVILY_API_KEY,
    brave: env.BRAVE_API_KEY,
  });

  const engine = new AgentEngine(repo, { llm, search }, {});

  return {
    engine,
    repo,
    connections: {
      [backend]: dbConnected,
      llm: Boolean(llm?.connected),
      search: Boolean(search?.connected),
    },
  };
}

async function runCycle(env: Env): Promise<Response> {
  const { engine, connections } = buildEngine(env);
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

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (req.method === 'OPTIONS') return new Response(null, { status: 204 });

    if (url.pathname === '/health') {
      const backend = env.DB_BACKEND ?? 'd1';
      return json({
        ok: true,
        service: 'survive-ai',
        time: new Date().toISOString(),
        connectors: {
          db: { backend, connected: backend === 'supabase' ? Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY) : Boolean(env.DB) },
          llm: Boolean(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY),
          search: Boolean(env.TAVILY_API_KEY || env.BRAVE_API_KEY),
          payments: false, // never enabled on the worker
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
        ]);
        return json({
          ok: true,
          fetchedAt: new Date().toISOString(),
          agent,
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
        });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/prospects/status' && req.method === 'POST') {
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
        await repo.updateProspectStatus(prospectId, status as ProspectStatus, typeof reasonLost === 'string' ? reasonLost : undefined);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'STATUS_CHANGE',
          summary: `Status updated to ${status} by operator.${reasonLost ? ` Reason: ${reasonLost}` : ''}`,
          createdAt: Date.now(),
        });
        return json({ ok: true, prospectId, status });
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
        const { repo } = buildEngine(env);
        const search = createSearchProvider({ tavily: env.TAVILY_API_KEY, brave: env.BRAVE_API_KEY });
        if (!search?.connected) {
          return json({ ok: false, error: 'no live search provider connected — nothing real to research' }, { status: 503 });
        }
        const llm = createLLMProvider({ anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY });
        const prospects = await repo.listProspects();
        const prospect = prospects.find((p) => p.id === prospectId);
        if (!prospect) return json({ ok: false, error: `no prospect found with id ${prospectId}` }, { status: 404 });

        const intel = await researchProspect(search, llm, prospect);
        await repo.upsertProspectIntelligence(intel);
        await repo.appendProspectInteraction({
          id: `pint_${crypto.randomUUID()}`,
          prospectId,
          kind: 'INTELLIGENCE_GATHERED',
          summary: `Deep research completed manually (${intel.generator === 'llm' ? 'AI-synthesized' : 'raw source digest'}, ${intel.confidence.toLowerCase()} confidence) — ${intel.sources.length} source(s) reviewed.`,
          createdAt: Date.now(),
        });
        return json({ ok: true, intelligence: intel });
      } catch (e) {
        return json({ ok: false, error: (e as Error).message }, { status: 500 });
      }
    }

    if (url.pathname === '/offers/status' && req.method === 'POST') {
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

    if (url.pathname === '/cycles/run' && req.method === 'POST') {
      const secret = req.headers.get('x-trigger-secret');
      if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET) {
        return json({ ok: false, error: 'unauthorized' }, { status: 401 });
      }
      return runCycle(env);
    }

    return json({ ok: false, error: 'not found' }, { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    // The cron fires regardless of agent status; runCycle no-ops safely if DEAD.
    ctx.waitUntil(
      (async () => {
        try {
          const { engine } = buildEngine(env);
          await engine.ensureSeeded();
          const outcome = await engine.runCycle({ useLive: true, stepDelay: 0 });
          console.log(
            `[cron] cycle ${outcome?.cycle.index} complete — status ${outcome?.finalStatus}, balance $${outcome?.balance.toFixed(2)}`,
          );
        } catch (e) {
          console.error('[cron] cycle failed:', (e as Error).message);
        }
      })(),
    );
  },
};
