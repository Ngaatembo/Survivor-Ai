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
        const [opportunities, experiments, transactions, memory, events, cycles, reports, strategies] =
          await Promise.all([
            repo.listOpportunities(),
            repo.listExperiments(),
            repo.listTransactions(),
            repo.listMemory(),
            repo.listEvents(),
            repo.listCycles(),
            repo.listReports(),
            repo.listStrategies(),
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
        });
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
