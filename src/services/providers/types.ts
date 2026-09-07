/* ============================================================================
 * Provider interfaces — implemented for the browser (fetch + VITE keys),
 * the Cloudflare Worker (fetch + secrets), and stubbed for offline/test mode.
 * Adding a new provider = implement these interfaces; nothing else changes.
 * ========================================================================== */

import type { Opportunity } from '../../types';

/** Reasoning / writing capability (Claude, OpenAI, or a future local model). */
export interface LLMProvider {
  readonly id: string;
  readonly connected: boolean;
  readonly label: string;

  /** Free-form completion with a system prompt. Returns text or null on failure. */
  complete(system: string, prompt: string): Promise<string | null>;

  /**
   * Produce a research brief for a candidate opportunity: fields extracted
   * from live sources, evidence tier, citations. Returns null if the model
   * cannot answer or the JSON is unusable (caller then keeps SAMPLE data).
   */
  analyzeOpportunity?(input: {
    name: string;
    category: string;
    snippets: string[];
  }): Promise<Partial<LLMOpportunityAnalysis> | null>;
}

export interface LLMOpportunityAnalysis {
  howMoneyMade: string;
  capitalRequiredMin: number;
  capitalRequiredMax: number;
  timeToRevenueDaysMin: number;
  timeToRevenueDaysMax: number;
  skills: string[];
  difficulty: number;
  competition: number;
  scalability: number;
  risk: number;
  successProbability: number;
  revenuePotentialMonthlyMin: number;
  revenuePotentialMonthlyMax: number;
  evidenceTier: Opportunity['evidenceTier'];
  evidenceNotes: string;
  upsideNote: string;
  downsideNote: string;
  operatingCostsNote: string;
  examples: string[];
  summary: string;
}

/** Web discovery capability (Tavily, Brave, or a future browser-automation feed). */
export interface SearchProvider {
  readonly id: string;
  readonly connected: boolean;
  readonly label: string;

  search(query: string, max?: number): Promise<SearchResult[]>;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  publishedAt?: string;
  source: string;
}

export interface Providers {
  llm: LLMProvider | null;
  search: SearchProvider | null;
}
