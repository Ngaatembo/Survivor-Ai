/* ============================================================================
 * StoreRepository — EngineRepository implementation that mutates the Zustand
 * browser store. This lets the in-browser demo run the EXACT same AgentEngine
 * class as the Cloudflare Worker (which uses SupabaseRepository instead).
 *
 * `get`/`set` are the zustand store's accessors, passed in to avoid a
 * circular import.
 * ========================================================================== */

import type {
  Agent,
  AgentCycle,
  AgentEvent,
  BusinessModel,
  CycleStepKey,
  Experiment,
  MemoryEntry,
  Opportunity,
  OpportunityDecision,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
} from '../types';
import type { EngineRepository } from './repository';
import { createSeedSnapshot } from './seed';

type StateShape = {
  agent: Agent;
  opportunities: Opportunity[];
  transactions: Transaction[];
  experiments: Experiment[];
  memory: MemoryEntry[];
  reports: ResearchReport[];
  events: AgentEvent[];
  strategies: Strategy[];
  cycles: AgentCycle[];
};

type Get = () => StateShape & Record<string, unknown>;
type Set = (partial: Partial<StateShape> | ((s: any) => any)) => void;

export function createStoreRepository(get: Get, set: Set, reseed: () => StateShape): EngineRepository {
  let cycleLockAt: number | null = null;
  // Commercial-core state (business models / decisions / recommended
  // actions) is kept in-memory for the browser demo rather than added to
  // the persisted Zustand store — the demo is a local sandbox, and the
  // durable, real target for this data is the production D1/Supabase
  // backend (see D1Repository/SupabaseRepository). Scoped this way so the
  // browser demo still exercises the full commercial-core code path
  // without a larger store.ts/localStorage-schema migration.
  let businessModels: BusinessModel[] = [];
  let decisions: OpportunityDecision[] = [];
  let actions: RecommendedAction[] = [];
  return {
    async getAgent() {
      return get().agent;
    },
    async updateAgent(patch) {
      const next = { ...get().agent, ...patch };
      set({ agent: next });
      return next;
    },
    async createAgentIfMissing(agent) {
      if (!get().agent) set({ agent });
      return get().agent;
    },
    async tryClaimCycle(staleAfterMs = 15 * 60 * 1000) {
      const agent = get().agent;
      if (!agent || agent.status === 'DEAD') return false;
      const locked = agent.status === 'RESEARCHING' || agent.status === 'EXECUTING';
      if (locked && cycleLockAt !== null && Date.now() - cycleLockAt < staleAfterMs) return false;
      cycleLockAt = Date.now();
      set({ agent: { ...agent, status: 'RESEARCHING' } });
      return true;
    },
    async releaseCycleLock(status) {
      cycleLockAt = null;
      const agent = get().agent;
      if (agent) set({ agent: { ...agent, status } });
    },

    async listOpportunities() {
      return get().opportunities;
    },
    async listResearchedOpportunities() {
      return get().opportunities.filter((o) => o.researchStage !== 'UNDISCOVERED');
    },
    async upsertOpportunities(opps) {
      const byId = new Map(get().opportunities.map((o) => [o.id, o]));
      for (const o of opps) byId.set(o.id, o);
      set({ opportunities: [...byId.values()] });
    },

    async listTransactions() {
      return get().transactions;
    },
    async appendTransaction(tx) {
      set((s: any) => ({ transactions: [...s.transactions, tx] }));
    },

    async listExperiments() {
      return get().experiments;
    },
    async appendExperiment(exp) {
      set((s: any) => ({ experiments: [exp, ...s.experiments] }));
    },

    async listMemory() {
      return get().memory;
    },
    async upsertMemory(mem) {
      set((s: any) => {
        const idx = s.memory.findIndex(
          (m: MemoryEntry) => m.kind === mem.kind && (mem.refId ? m.refId === mem.refId : m.id === mem.id),
        );
        if (idx >= 0) {
          const copy = [...s.memory];
          copy[idx] = mem;
          return { memory: copy };
        }
        return { memory: [mem, ...s.memory] };
      });
    },

    async listReports() {
      return get().reports;
    },
    async appendReport(report) {
      set((s: any) => ({
        reports: [report, ...s.reports.filter((r: ResearchReport) => r.opportunityId !== report.opportunityId)],
      }));
    },

    async listStrategies() {
      return get().strategies;
    },
    async appendStrategy(strategy) {
      set((s: any) => ({
        strategies: [
          { ...strategy, active: true },
          ...s.strategies.map((x: Strategy) => ({ ...x, active: false })),
        ],
      }));
    },
    async deactivateStrategies() {
      set((s: any) => ({ strategies: s.strategies.map((x: Strategy) => ({ ...x, active: false })) }));
    },

    async listEvents() {
      return get().events;
    },
    async appendEvent(event) {
      set((s: any) => ({ events: [...s.events, event].slice(-250) }));
    },

    async listCycles() {
      return get().cycles;
    },
    async appendCycle(cycle) {
      set((s: any) => ({ cycles: [...s.cycles, cycle].slice(-60) }));
    },
    async updateCycleStep(cycleId, step, status, at) {
      set((s: any) => ({
        cycles: s.cycles.map((c: AgentCycle) =>
          c.id !== cycleId
            ? c
            : {
                ...c,
                steps: c.steps.map((st) =>
                  st.key === step
                    ? { ...st, status, at: status === 'done' ? at ?? Date.now() : st.at }
                    : st,
                ),
              },
        ),
      }));
    },
    async completeCycle(cycleId, patch) {
      set((s: any) => ({
        cycles: s.cycles.map((c: AgentCycle) => (c.id === cycleId ? { ...c, ...patch } : c)),
      }));
    },

    async reset() {
      businessModels = [];
      decisions = [];
      actions = [];
      set(reseed() as any);
    },

    async listBusinessModels() {
      return businessModels;
    },
    async upsertBusinessModel(model) {
      businessModels = [model, ...businessModels.filter((m) => m.opportunityId !== model.opportunityId)];
    },

    async listDecisions() {
      return decisions;
    },
    async appendDecision(decision) {
      decisions = [decision, ...decisions].slice(0, 500);
    },

    async listActions() {
      return actions;
    },
    async replaceActions(next) {
      actions = next;
    },
  };
}

export { createSeedSnapshot };
