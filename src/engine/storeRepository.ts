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
  CycleStepKey,
  Experiment,
  MemoryEntry,
  Opportunity,
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
  return {
    async getAgent() {
      return get().agent;
    },
    async updateAgent(patch) {
      const next = { ...get().agent, ...patch };
      set({ agent: next });
      return next;
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
      set(reseed() as any);
    },
  };
}

export { createSeedSnapshot };
