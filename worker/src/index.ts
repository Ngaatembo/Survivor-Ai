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