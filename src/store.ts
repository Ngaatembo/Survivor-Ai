/* ============================================================================
 * SURVIVE AI — browser store.
 * Thin orchestration over the shared, transport-independent AgentEngine.
 * The engine writes through a StoreRepository (zustand), so the in-browser
 * demo and the Cloudflare Worker (SupabaseRepository) run identical logic.
 * State persists to localStorage; engine internals are not persisted.
 * ========================================================================== */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Agent,
  AgentCycle,
  AgentEvent,
  BusinessModel,
  CycleStepKey,
  DesignBrief,
  Experiment,
  LearningEvent,
  MarketPriceResearch,
  MemoryEntry,
  Mission,
  Offer,
  Opportunity,
  OpportunityDecision,
  OutreachMessageSet,
  Project,
  ProjectMilestoneKey,
  Prospect,
  ProspectDemo,
  ProspectInteraction,
  ProspectIntelligence,
  ProspectStatus,
  RealRevenueEntry,
  RecommendedAction,
  ResearchReport,
  Strategy,
  Transaction,
} from './types';
import { uid } from './lib/format';
import { simulateExperiment, experimentBudget } from './lib/simulation';
import { record as ledgerRecord, balanceFrom } from './services/wallet';
import { scoreOpportunity } from './lib/scoring';
import { recordResult, lessonFromExperiment } from './services/memory';
import { decide, strategyFromMemory } from './services/ai';
import { AgentEngine } from './engine/agentEngine';
import { createStoreRepository } from './engine/storeRepository';
import { createSeedSnapshot, computeSurvivalStatus } from './engine/seed';
import { createLLMProvider } from './services/providers/llm';
import { createSearchProviders } from './services/providers/search';
import { env, featureFlags } from './config/env';
import { computeProfit, generateLearningEvent, foldRealRevenueIntoMemory, computeCategoryRealWorldStats, statsForCategory } from './lib/realRevenue';
import { researchProspect } from './services/prospectIntelligence';
import { loadEconomyState, saveEconomyState } from './services/searchEconomy';
import { generateProspectDemo } from './lib/demoGenerator';
import {
  fetchBackendState,
  fetchBackendHealth,
  BackendError,
  updateProspectStatus as apiUpdateProspectStatus,
  updateOfferStatus as apiUpdateOfferStatus,
  advanceProjectMilestone as apiAdvanceProjectMilestone,
  addRealRevenueEntry as apiAddRealRevenueEntry,
  updateProjectOutcome as apiUpdateProjectOutcome,
  researchProspectNow as apiResearchProspectNow,
  regenerateProspectDemo as apiRegenerateProspectDemo,
  demoUrl as apiDemoUrl,
  type EconomicEfficiencySnapshot,
} from './services/backendApi';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

function seedInitialState() {
  const snap = createSeedSnapshot();
  return {
    agent: snap.agent,
    opportunities: snap.opportunities,
    reports: [] as ResearchReport[],
    experiments: [] as Experiment[],
    memory: [] as MemoryEntry[],
    transactions: snap.transactions,
    events: snap.events,
    strategies: snap.strategies,
    cycles: [] as AgentCycle[],
    // Commercial core (build-spec §3/§5/§16) — populated from the live
    // backend in backend mode; the standalone browser demo leaves these
    // empty (the engine still computes them via StoreRepository, but they
    // are intentionally not round-tripped into persisted Zustand state —
    // see storeRepository.ts's comment on this scoping decision).
    businessModels: [] as BusinessModel[],
    decisions: [] as OpportunityDecision[],
    actions: [] as RecommendedAction[],
    prospects: [] as Prospect[],
    prospectInteractions: [] as ProspectInteraction[],
    outreachMessages: [] as OutreachMessageSet[],
    // Offer + delivery (Phase 3) — same scoping note as above.
    offers: [] as Offer[],
    designBriefs: [] as DesignBrief[],
    projects: [] as Project[],
    realRevenue: [] as RealRevenueEntry[],
    learningEvents: [] as LearningEvent[],
    prospectIntelligence: [] as ProspectIntelligence[],
    prospectDemos: [] as Omit<ProspectDemo, 'html'>[],
    marketPriceResearch: [] as MarketPriceResearch[],
    missions: [] as Mission[],
    // Economic Survival Overhaul — only ever populated from the backend's
    // /state (server-computed); the local browser demo does not attempt to
    // recompute it, so it stays null there (the EconomicEfficiency panel
    // renders an honest "backend-only" note in that mode).
    economicEfficiency: null as EconomicEfficiencySnapshot | null,
  };
}

interface LoopState {
  running: boolean;
  busy: boolean;
  currentStep: CycleStepKey | null;
  activeCycleId: string | null;
  activity: string;
}

/** Status of the read-only mirror of the deployed backend (D1/Worker). */
interface BackendSyncState {
  /** True once at least one successful /state fetch has completed. */
  connected: boolean;
  syncing: boolean;
  error: string | null;
  lastSyncedAt: number | null;
}

interface SurviveState {
  agent: Agent;
  opportunities: Opportunity[];
  reports: ResearchReport[];
  experiments: Experiment[];
  memory: MemoryEntry[];
  transactions: Transaction[];
  events: AgentEvent[];
  strategies: Strategy[];
  cycles: AgentCycle[];
  businessModels: BusinessModel[];
  decisions: OpportunityDecision[];
  actions: RecommendedAction[];
  prospects: Prospect[];
  prospectInteractions: ProspectInteraction[];
  outreachMessages: OutreachMessageSet[];
  offers: Offer[];
  designBriefs: DesignBrief[];
  projects: Project[];
  realRevenue: RealRevenueEntry[];
  learningEvents: LearningEvent[];
  prospectIntelligence: ProspectIntelligence[];
  // Metadata only — the full HTML lives in the repo (demo mode) or is
  // fetched on demand from the backend (live mode), never persisted here.
  prospectDemos: Omit<ProspectDemo, 'html'>[];
  marketPriceResearch: MarketPriceResearch[];
  missions: Mission[];
  economicEfficiency: EconomicEfficiencySnapshot | null;
  loop: LoopState;
  backend: BackendSyncState;

  logEvent: (type: AgentEvent['type'], message: string) => void;
  startLoop: () => void;
  pauseLoop: () => void;
  runNextCycle: () => void;
  resetSimulation: () => void;
  runManualExperiment: (opportunityId: string) => void;
  generateReportFor: (opportunityId: string) => void;
  syncFromBackend: () => Promise<void>;
  /** Human-driven CRM write path (Phase 3). Backend mode calls the Worker
   *  endpoint (never called by the autonomous loop); demo mode writes
   *  straight through the local StoreRepository. */
  updateProspectStatus: (prospectId: string, status: ProspectStatus, reasonLost?: string) => Promise<void>;
  updateOfferStatus: (offerId: string, status: Offer['status']) => Promise<void>;
  advanceProjectMilestone: (projectId: string, milestone: ProjectMilestoneKey) => Promise<void>;
  /** Real-money write path (Phase 4) — always human-entered, never
   *  autonomous. Same backend/demo-mode split as the actions above. */
  addRealRevenueEntry: (input: {
    opportunityId: string;
    prospectId: string;
    prospectName?: string;
    projectId: string;
    productService: string;
    quotedPrice?: number;
    amountReceived: number;
    costs?: number;
    currency?: string;
    paymentMethod?: RealRevenueEntry['paymentMethod'];
    acquisitionChannel?: string;
    daysFromDiscoveryToPayment?: number;
    notes?: string;
  }) => Promise<void>;
  updateProjectOutcome: (
    projectId: string,
    outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
  ) => Promise<void>;
  /** Phase 6 — manually trigger deep research on one specific prospect
   *  right now. Backend mode calls the Worker endpoint; demo mode runs the
   *  same researchProspect() function directly against the local
   *  search/LLM providers. Requires live search to be connected. */
  researchProspectNow: (prospectId: string) => Promise<void>;
  /** Phase 3 (deepened) — manually regenerate a prospect's real, working
   *  demo page right now. Requires an existing offer for this prospect. */
  regenerateProspectDemo: (prospectId: string) => Promise<void>;
  /** Open the actual demo page in a new tab — the real backend URL in
   *  live mode, or a local Blob URL built from the repo's stored HTML in
   *  demo mode (there's no server to serve it from there). */
  viewProspectDemo: (prospectId: string) => Promise<void>;
  _runAuto: () => Promise<void>;
}

/**
 * When VITE_API_BASE_URL is configured, the deployed backend/D1 is the sole
 * source of truth (fixes the frontend/backend disconnect — see README /
 * DEPLOYMENT.md "CRITICAL EXISTING PROBLEM"). The local autonomous loop,
 * manual-experiment and reset actions are disabled in this mode: they would
 * otherwise mutate a second, independent copy of "the" wallet/opportunities/
 * experiments purely in the browser, which is exactly the bug this fixes.
 * generateReportFor's local scoring fallback is also skipped in backend mode
 * (reports are generated server-side).
 */
function guardLocalMutation(get: () => SurviveState): boolean {
  if (!featureFlags.backend) return false;
  get().logEvent(
    'WARNING',
    'Live backend mode: the autonomous loop runs on the Cloudflare Worker cron. Local demo controls are disabled so the dashboard never disagrees with the backend.',
  );
  return true;
}

export const useStore = create<SurviveState>()(
  persist(
    (set, get) => {
      /* -------- engine wiring: providers from env (absent → rule engine) ------ */
      const llm = createLLMProvider({ anthropic: env.anthropicKey, openai: env.openaiKey });
      const { tavily, brave } = createSearchProviders({ tavily: env.tavilyKey, brave: env.braveKey });

      const repo = createStoreRepository(
        () => get() as any,
        set as any,
        () => seedInitialState() as any,
      );

      const engine = new AgentEngine(
        repo,
        { llm, tavily, brave },
        {
          // Note: engine events are already persisted through StoreRepository
          // (appendEvent writes to store.events), so onLog is intentionally a
          // no-op here — it is only needed by hosts whose repo does not
          // stream back into the UI.
          onStatus: (status) => {
            set((s: any) => ({ agent: { ...s.agent, status } }));
          },
          onActivity: (activity, step) => {
            set((s: any) => {
              const cycles = s.cycles as AgentCycle[];
              const latest = cycles.length ? cycles[cycles.length - 1] : null;
              return {
                loop: {
                  ...s.loop,
                  activity,
                  currentStep: step,
                  activeCycleId: latest?.id ?? s.loop.activeCycleId,
                },
              };
            });
          },
        },
      );

      return {
        ...seedInitialState(),
        loop: {
          running: false,
          busy: false,
          currentStep: null,
          activeCycleId: null,
          activity: featureFlags.backend ? 'Connecting to live backend…' : 'Idle — awaiting research instructions.',
        },
        backend: {
          connected: false,
          syncing: false,
          error: null,
          lastSyncedAt: null,
        },

        syncFromBackend: async () => {
          if (!featureFlags.backend) return;
          if (get().backend.syncing) return;
          set((s: any) => ({ backend: { ...s.backend, syncing: true } }));
          try {
            const [state, health] = await Promise.all([fetchBackendState(), fetchBackendHealth()]);
            set({
              agent: state.agent,
              opportunities: state.opportunities,
              experiments: state.experiments,
              transactions: state.transactions,
              memory: state.memory,
              events: state.events,
              cycles: state.cycles,
              reports: state.reports,
              strategies: state.strategies,
              businessModels: state.businessModels,
              decisions: state.decisions,
              actions: state.actions,
              prospects: state.prospects,
              prospectInteractions: state.prospectInteractions,
              outreachMessages: state.outreachMessages,
              offers: state.offers,
              designBriefs: state.designBriefs,
              projects: state.projects,
              realRevenue: state.realRevenue,
              learningEvents: state.learningEvents,
              prospectIntelligence: state.prospectIntelligence,
              prospectDemos: state.prospectDemos,
              marketPriceResearch: state.marketPriceResearch,
              missions: state.missions,
              economicEfficiency: state.economicEfficiency ?? null,
              backend: {
                connected: true,
                syncing: false,
                error: null,
                lastSyncedAt: Date.now(),
              },
            } as any);
            void health; // surfaced via useBackendHealth() below if needed later
          } catch (e) {
            const message = e instanceof BackendError ? e.message : (e as Error).message;
            set((s: any) => ({
              backend: { ...s.backend, syncing: false, connected: false, error: message },
            }));
          }
        },

        updateProspectStatus: async (prospectId: string, status: ProspectStatus, reasonLost?: string) => {
          if (featureFlags.backend) {
            try {
              await apiUpdateProspectStatus(prospectId, status, reasonLost);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to update prospect status: ${message}`);
            }
            return;
          }
          await repo.updateProspectStatus(prospectId, status, reasonLost);
          set({ prospects: await repo.listProspects() } as any);
        },

        updateOfferStatus: async (offerId: string, status: Offer['status']) => {
          if (featureFlags.backend) {
            try {
              await apiUpdateOfferStatus(offerId, status);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to update offer status: ${message}`);
            }
            return;
          }
          await repo.updateOfferStatus(offerId, status);
          set({ offers: await repo.listOffers() } as any);
        },

        advanceProjectMilestone: async (projectId: string, milestone: ProjectMilestoneKey) => {
          if (featureFlags.backend) {
            try {
              await apiAdvanceProjectMilestone(projectId, milestone);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to advance project milestone: ${message}`);
            }
            return;
          }
          await repo.advanceProjectMilestone(projectId, milestone);
          set({ projects: await repo.listProjects() } as any);
        },

        addRealRevenueEntry: async (input: {
          opportunityId: string;
          prospectId: string;
          prospectName?: string;
          projectId: string;
          productService: string;
          quotedPrice?: number;
          amountReceived: number;
          costs?: number;
          currency?: string;
          paymentMethod?: RealRevenueEntry['paymentMethod'];
          acquisitionChannel?: string;
          daysFromDiscoveryToPayment?: number;
          notes?: string;
        }) => {
          if (featureFlags.backend) {
            try {
              await apiAddRealRevenueEntry(input);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to record real revenue: ${message}`);
            }
            return;
          }
          // Demo mode: mirror the worker's /real-revenue handler exactly —
          // append the entry, generate one learning event, fold a note
          // into memory. Never touches the simulated wallet.
          const [opportunities, businessModels, memory, prospects] = await Promise.all([
            repo.listOpportunities(),
            repo.listBusinessModels(),
            repo.listMemory(),
            repo.listProspects(),
          ]);
          const opp = opportunities.find((o) => o.id === input.opportunityId);
          if (!opp) {
            get().logEvent('WARNING', `Failed to record real revenue: no opportunity found with id ${input.opportunityId}`);
            return;
          }
          const model = businessModels.find((m) => m.opportunityId === input.opportunityId);
          const now = Date.now();
          const entry: RealRevenueEntry = {
            id: uid('rr'),
            date: now,
            opportunityId: input.opportunityId,
            opportunityName: opp.name,
            prospectId: input.prospectId,
            prospectName: input.prospectName ?? '',
            projectId: input.projectId,
            productService: input.productService,
            quotedPrice: input.quotedPrice ?? 0,
            amountReceived: input.amountReceived,
            costs: input.costs ?? 0,
            profit: computeProfit(input.amountReceived, input.costs ?? 0),
            currency: input.currency ?? 'USD',
            paymentMethod: input.paymentMethod ?? 'OTHER',
            acquisitionChannel: input.acquisitionChannel ?? '',
            daysFromDiscoveryToPayment: input.daysFromDiscoveryToPayment ?? 0,
            notes: input.notes,
            createdAt: now,
          };
          await repo.addRealRevenueEntry(entry);
          const learningEvent = generateLearningEvent(entry, opp, model, now);
          await repo.appendLearningEvent(learningEvent);
          const categoryStats = statsForCategory(
            computeCategoryRealWorldStats(opportunities, prospects, await repo.listRealRevenue()),
            opp.category,
          );
          const updatedMemory = foldRealRevenueIntoMemory(memory, entry, opp, categoryStats, now);
          for (const m of updatedMemory) {
            if (!memory.includes(m)) await repo.upsertMemory(m);
          }
          set({
            realRevenue: await repo.listRealRevenue(),
            learningEvents: await repo.listLearningEvents(),
          } as any);
        },

        updateProjectOutcome: async (
          projectId: string,
          outcome: { satisfaction?: number; repeatPurchase?: boolean; referral?: boolean },
        ) => {
          if (featureFlags.backend) {
            try {
              await apiUpdateProjectOutcome(projectId, outcome);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to update project outcome: ${message}`);
            }
            return;
          }
          await repo.updateProjectOutcome(projectId, outcome);
          set({ projects: await repo.listProjects() } as any);
        },

        researchProspectNow: async (prospectId: string) => {
          if (featureFlags.backend) {
            try {
              await apiResearchProspectNow(prospectId);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to research prospect: ${message}`);
            }
            return;
          }
          if (!tavily?.connected && !brave?.connected) {
            get().logEvent('WARNING', 'Failed to research prospect: no live search provider connected.');
            return;
          }
          const prospects = await repo.listProspects();
          const prospect = prospects.find((p) => p.id === prospectId);
          if (!prospect) {
            get().logEvent('WARNING', `Failed to research prospect: no prospect found with id ${prospectId}.`);
            return;
          }
          const now = Date.now();
          const balance = balanceFrom(await repo.listTransactions());
          const economyState = await loadEconomyState(repo);
          const ctx = {
            state: economyState,
            providers: { tavily, brave },
            survivalStatus: computeSurvivalStatus(balance),
            now,
            cycleStartedAt: now,
          };
          const intel = await researchProspect(ctx, llm, prospect, now, { statusChanged: true });
          await saveEconomyState(repo, ctx.state);
          await repo.upsertProspectIntelligence(intel);
          set({ prospectIntelligence: await repo.listProspectIntelligence() } as any);
        },

        regenerateProspectDemo: async (prospectId: string) => {
          if (featureFlags.backend) {
            try {
              await apiRegenerateProspectDemo(prospectId);
              await get().syncFromBackend();
            } catch (e) {
              const message = e instanceof BackendError ? e.message : (e as Error).message;
              get().logEvent('WARNING', `Failed to regenerate demo: ${message}`);
            }
            return;
          }
          const [prospects, offers, intelligenceList] = await Promise.all([
            repo.listProspects(),
            repo.listOffers(),
            repo.listProspectIntelligence(),
          ]);
          const prospect = prospects.find((p) => p.id === prospectId);
          if (!prospect) {
            get().logEvent('WARNING', `Failed to regenerate demo: no prospect found with id ${prospectId}.`);
            return;
          }
          const offer = offers.find((o) => o.prospectId === prospectId);
          if (!offer) {
            get().logEvent('WARNING', 'Failed to regenerate demo: no offer exists for this prospect yet.');
            return;
          }
          const intel = intelligenceList.find((i) => i.prospectId === prospectId);
          const demo = generateProspectDemo(prospect, offer, intel);
          await repo.upsertProspectDemo(demo);
          const allDemos = await repo.listProspectDemos();
          set({ prospectDemos: allDemos.map(({ html, ...meta }) => meta) } as any);
        },

        viewProspectDemo: async (prospectId: string) => {
          if (featureFlags.backend) {
            (globalThis as any).open(apiDemoUrl(prospectId), '_blank', 'noopener,noreferrer');
            return;
          }
          const demos = await repo.listProspectDemos();
          const demo = demos.find((d) => d.prospectId === prospectId);
          if (!demo) {
            get().logEvent('WARNING', 'No demo found for this prospect yet.');
            return;
          }
          const blobUrl = URL.createObjectURL(new Blob([demo.html], { type: 'text/html' }));
          (globalThis as any).open(blobUrl, '_blank', 'noopener,noreferrer');
        },

        logEvent: (type: AgentEvent['type'], message: string) =>
          set((s: any) => ({
            events: [...s.events, { id: uid('evt'), type, message, createdAt: Date.now() }].slice(-250),
          })),

        startLoop: () => {
          if (guardLocalMutation(get)) return;
          const s = get();
          if (s.agent.status === 'DEAD') {
            get().logEvent('WARNING', 'Agent is DEAD. Reset the simulation to restart.');
            return;
          }
          if (s.loop.busy) return;
          set((st: any) => ({
            loop: { ...st.loop, running: true, activity: 'Research loop started — running autonomously.' },
            agent: { ...st.agent, status: 'RESEARCHING' },
          }));
          get().logEvent('CYCLE', 'Autonomous research loop STARTED.');
          void get()._runAuto();
        },

        pauseLoop: () => {
          if (guardLocalMutation(get)) return;
          if (!get().loop.running) return;
          set((st: any) => ({ loop: { ...st.loop, running: false } }));
          get().logEvent('CYCLE', 'Pause requested — agent will halt after the current step.');
        },

        runNextCycle: () => {
          if (guardLocalMutation(get)) return;
          const s = get();
          if (s.loop.busy) return;
          if (s.agent.status === 'DEAD') {
            get().logEvent('WARNING', 'Agent is DEAD. Reset the simulation to continue.');
            return;
          }
          void runOneCycle(false);
        },

        resetSimulation: () => {
          if (guardLocalMutation(get)) return;
          const fresh = seedInitialState();
          set({
            ...fresh,
            loop: {
              running: false,
              busy: false,
              currentStep: null,
              activeCycleId: null,
              activity: 'Simulation reset — $50 seed restored.',
            },
          } as any);
          get().logEvent('SYSTEM', 'Simulation reset to initial $50.00 seeded state.');
        },

        /* Manual experiment (Decision Center / Explorer). Uses the same
         * simulation + memory services as the autonomous loop. */
        runManualExperiment: (opportunityId: string) => {
          if (guardLocalMutation(get)) return;
          const s = get();
          if (s.agent.status === 'DEAD') {
            get().logEvent('WARNING', 'Agent is DEAD — experiments are locked.');
            return;
          }
          if (s.loop.busy) return;
          const opp = s.opportunities.find((o: Opportunity) => o.id === opportunityId);
          if (!opp) return;
          if (opp.executionBlocked) {
            get().logEvent('REJECTION', `Manual experiment blocked: "${opp.name}" — ${opp.blockReason}`);
            return;
          }
          const balance = balanceFrom(s.transactions);
          const budget = experimentBudget(opp, balance);
          if (budget <= 0 || balance < budget) {
            get().logEvent('WARNING', `Insufficient simulated balance for "${opp.name}".`);
            return;
          }

          set((st: any) => ({
            agent: { ...st.agent, status: 'EXECUTING' },
            loop: { ...st.loop, busy: true, activity: `Simulating: ${opp.name}…` },
          }));

          const manualExpId = uid('exp');
          const expenseTx = ledgerRecord(get().transactions, {
            type: 'EXPENSE',
            amount: -budget,
            description: `Simulated experiment budget — ${opp.name} (manual)`,
            relatedExperimentId: manualExpId,
          }).slice(-1)[0];
          set((st: any) => ({ transactions: [...st.transactions, expenseTx] }));
          get().logEvent('EXPERIMENT', `Manual experiment simulation created for "${opp.name}" — $${budget.toFixed(2)} simulated budget.`);

          const sim = simulateExperiment({
            opportunity: opp,
            budget,
            memory: get().memory.find((m: MemoryEntry) => m.kind === 'opportunity' && m.refId === opp.id),
          });

          let transactions = get().transactions;
          if (sim.actualRevenue > 0) {
            const revenueTx = ledgerRecord(transactions, {
              type: 'REVENUE',
              amount: sim.actualRevenue,
              description: `Simulated revenue — ${opp.name} (manual)`,
              relatedExperimentId: manualExpId,
            }).slice(-1)[0];
            transactions = [...transactions, revenueTx];
            set({ transactions });
          }

          const experiment: Experiment = {
            id: manualExpId,
            cycleId: null,
            opportunityId: opp.id,
            opportunityName: opp.name,
            category: opp.category,
            objective: `Validate demand for "${opp.name}" (manually launched from Decision Center).`,
            startingBudget: budget,
            plannedAction: 'Single minimal test, single channel, capped budget.',
            expectedOutcome: 'First revenue signal or validated demand.',
            actualCost: sim.actualCost,
            actualRevenue: sim.actualRevenue,
            profitLoss: Math.round((sim.actualRevenue - sim.actualCost) * 100) / 100,
            roi: sim.actualCost > 0 ? Math.round(((sim.actualRevenue - sim.actualCost) / sim.actualCost) * 100) : 0,
            outcome: sim.outcome,
            durationDays: sim.durationDays,
            lessonsLearned: sim.lessons,
            evidenceNote: sim.evidenceNote,
            simulated: true,
            createdAt: Date.now(),
          };

          const updatedMemory: MemoryEntry[] = recordResult(get().memory, experiment, opp);
          const memory = [lessonFromExperiment(experiment), ...updatedMemory];
          const finalBalance = balanceFrom(get().transactions);
          const { strategy, objective } = strategyFromMemory(memory, finalBalance, get().agent.survivalThreshold);

          set((st: any) => ({
            experiments: [experiment, ...st.experiments],
            memory,
            agent: {
              ...st.agent,
              status: finalBalance <= 0 ? 'DEAD' : finalBalance < st.agent.survivalThreshold ? 'AT_RISK' : 'ALIVE',
              currentStrategy: strategy,
              currentObjective: objective,
            },
            loop: { ...st.loop, busy: false, currentStep: null, activity: 'Manual experiment complete.' },
          }));
          get().logEvent(
            'EXPERIMENT',
            `Manual experiment outcome: ${sim.outcome.replace('_', ' ')} — cost $${sim.actualCost.toFixed(2)}, revenue $${sim.actualRevenue.toFixed(2)}, ROI ${experiment.roi}%.`,
          );
        },

        /* Reports go through the engine (same generator as the worker). */
        generateReportFor: async (opportunityId: string) => {
          if (guardLocalMutation(get)) return;
          // Ensure score exists locally before generating.
          const opp = get().opportunities.find((o: Opportunity) => o.id === opportunityId);
          if (opp && !opp.score) {
            const scored = { ...opp, score: scoreOpportunity(opp) };
            set((st: any) => ({
              opportunities: st.opportunities.map((o: Opportunity) => (o.id === opp.id ? scored : o)),
            }));
          }
          const report = await engine.generateReportFor(opportunityId);
          if (report) {
            set((st: any) => ({
              reports: [report, ...st.reports.filter((r: ResearchReport) => r.opportunityId !== opportunityId)],
            }));
            get().logEvent('SYSTEM', `Research report generated for "${opp?.name}" (${llm?.connected ? llm.label : 'rule engine'}).`);
          }
        },

        _runAuto: async () => {
          while (get().loop.running) {
            if (get().agent.status === 'DEAD') break;
            await runOneCycle(true);
            if (!get().loop.running) break;
            await delay(1300);
          }
        },
      };

      async function runOneCycle(auto: boolean) {
        if (get().loop.busy) return;
        set((st: any) => ({ loop: { ...st.loop, busy: true } }));
        try {
          await engine.runCycle({
            useLive: true,
            stepDelay: 620,
            shouldContinue: () => (auto ? get().loop.running : true),
          });
        } catch (e) {
          get().logEvent('WARNING', `Cycle error: ${(e as Error).message}`);
        } finally {
          const balance = balanceFrom(get().transactions);
          const dead = balance <= 0;
          const running = get().loop.running;
          set((st: any) => ({
            loop: {
              ...st.loop,
              busy: false,
              currentStep: null,
              activeCycleId: null,
              running: dead ? false : running,
              activity: dead
                ? 'Agent DEAD — capital exhausted. Reset to start a new simulation.'
                : running
                  ? 'Research loop running — beginning next cycle…'
                  : 'Idle — research cycle complete.',
            },
            agent: {
              ...st.agent,
              status: dead
                ? 'DEAD'
                : running
                  ? 'RESEARCHING'
                  : balance < st.agent.survivalThreshold
                    ? 'AT_RISK'
                    : 'ALIVE',
            },
          }));
        }
      }
    },
    {
      name: 'survive-ai-v2',
      // In live-backend mode, business state is NEVER the browser's to keep:
      // it is refetched from the backend on every load and every poll, and
      // persisting a second copy to localStorage is exactly the "independent
      // browser state" bug this integration fixes. Only the standalone demo
      // (no backend configured) persists its simulated state locally.
      partialize: (s: any) =>
        featureFlags.backend
          ? {}
          : {
              agent: s.agent,
              opportunities: s.opportunities,
              reports: s.reports,
              experiments: s.experiments,
              memory: s.memory,
              transactions: s.transactions,
              events: s.events,
              strategies: s.strategies,
              cycles: s.cycles,
            },
      onRehydrateStorage: () => (state: any) => {
        if (featureFlags.backend) {
          // Nothing meaningful was persisted (see partialize above) — the
          // first syncFromBackend() call (kicked off below) populates state.
          return;
        }
        if (!state) return;
        const balance = balanceFrom(state.transactions ?? []);
        const status =
          balance <= 0 ? 'DEAD' : balance < (state.agent?.survivalThreshold ?? 5) ? 'AT_RISK' : 'ALIVE';
        useStore.setState({
          agent: { ...state.agent, status },
          loop: {
            running: false,
            busy: false,
            currentStep: null,
            activeCycleId: null,
            activity: 'Idle — awaiting research instructions.',
          },
        });
      },
    },
  ),
);

/* ------------------------- live backend polling ---------------------------- */
// When a backend is configured, the dashboard is a read-only mirror of it:
// sync immediately on load, then on a short interval. This (plus the guards
// above) is what makes the backend/D1 the sole source of truth end-to-end —
// PHASE 3 / "Frontend must use the backend as its source of truth."
const BACKEND_POLL_MS = 15_000;
if (featureFlags.backend) {
  void useStore.getState().syncFromBackend();
  setInterval(() => {
    void useStore.getState().syncFromBackend();
  }, BACKEND_POLL_MS);
}

/* ------------------------------ selectors --------------------------------- */

export function useWalletTotals() {
  const transactions = useStore((s) => s.transactions);
  let revenue = 0;
  let expenses = 0;
  for (const t of transactions) {
    if (t.amount > 0 && t.type !== 'DEPOSIT') revenue += t.amount;
    if (t.amount < 0) expenses += Math.abs(t.amount);
  }
  return {
    balance: balanceFrom(transactions),
    revenue: Math.round(revenue * 100) / 100,
    expenses: Math.round(expenses * 100) / 100,
    profit: Math.round((revenue - expenses) * 100) / 100,
  };
}

/** Live connection flags for the connectors panel (browser). */
export const browserConnections = {
  supabase: featureFlags.supabase,
  search: featureFlags.search,
  llmClaude: Boolean(env.anthropicKey),
  llmOpenai: Boolean(env.openaiKey),
  // True once the backend URL is configured AND at least one /state fetch
  // has actually succeeded — configured-but-unreachable reads as false here.
  get workers() {
    return featureFlags.backend && useStore.getState().backend.connected;
  },
};

/** True when the dashboard is mirroring a deployed backend (config only —
 *  does not imply the connection is currently healthy; see backend.connected
 *  in the store for that). */
export const backendConfigured = featureFlags.backend;
