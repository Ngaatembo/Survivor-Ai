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
import type { ProspectStatus, OfferStatus, ProjectMilestoneKey, RealRevenueEntry } from '../../src/types';
import { computeProfit, generateLearningEvent, foldRealRevenueIntoMemory, computeCategoryRealWorldStats, statsForCategory } from '../../src/lib/realRevenue';
import { researchProspect } from '../../src/services/prospectIntelligence';
import { verifyProspect } from '../../src/services/prospectVerification';
import { generateProspectDemo } from '../../src/lib/demoGenerator';
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
