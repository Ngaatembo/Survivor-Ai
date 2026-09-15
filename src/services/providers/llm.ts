/* ============================================================================
 * LLM providers — Anthropic (Claude) and OpenAI.
 * Pure fetch: works in browser and in Cloudflare Workers. Each method fails
 * soft (returns null) so the engine falls back to the rule engine.
 * ========================================================================== */

import type { LLMOpportunityAnalysis, LLMProvider, MarketPriceAnalysis, ProspectIntelligenceAnalysis } from './types';

const ANALYSIS_SCHEMA_HINT = `Return ONLY minified JSON with this shape:
{"howMoneyMade":string,"capitalRequiredMin":number,"capitalRequiredMax":number,
"timeToRevenueDaysMin":number,"timeToRevenueDaysMax":number,"skills":string[],
"difficulty":1-5,"competition":1-5,"scalability":1-5,"risk":1-5,
"successProbability":0-1,"revenuePotentialMonthlyMin":number,
"revenuePotentialMonthlyMax":number,
"evidenceTier":"VERIFIED|LIKELY|UNCERTAIN|UNVERIFIED",
"evidenceNotes":string,"upsideNote":string,"downsideNote":string,
"operatingCostsNote":string,"examples":string[],"summary":string}
Conservative, realistic numbers for a beginner with ~$50. If sources are weak,
use UNCERTAIN/UNVERIFIED. No prose outside the JSON.`;

const PROSPECT_SCHEMA_HINT = `Return ONLY minified JSON with this shape:
{"businessOverview":string,"apparentServices":string[],"socialPresenceSummary":string,
"competitiveNote":string,"specificProblemEvidence":string,"recommendedAngle":string,
"confidence":"HIGH|MEDIUM|LOW"}
Base every field ONLY on the provided snippets — never invent a service, review, or
fact this business doesn't have evidence for in the snippets. If the snippets don't
support a field, say so plainly in that field rather than guessing (e.g.
"no evidence found of X in available sources"). Use LOW confidence when snippets are
thin or generic. No prose outside the JSON.`;

const MARKET_PRICE_SCHEMA_HINT = `Return ONLY minified JSON with this shape:
{"priceMin":number,"priceMax":number,"currency":string,"rationale":string,
"confidence":"HIGH|MEDIUM|LOW"}
Base the price range ONLY on real going-rate figures actually present in the
snippets (e.g. a freelancer's listed rate, a competitor's quoted price, a market
survey figure) — never estimate from theory or general knowledge if the snippets
don't contain a real number. If the snippets don't contain any real pricing
evidence, return confidence "LOW" and set priceMin/priceMax to your best honest
read of whatever partial evidence exists, explaining the gap in rationale. No
prose outside the JSON.`;

function extractJson(text: string): unknown {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1) throw new Error('no json in response');
  return JSON.parse(text.slice(start, end + 1));
}

/* ------------------------------ Anthropic --------------------------------- */

class AnthropicProvider implements LLMProvider {
  readonly id = 'claude';
  readonly label = 'Claude (Anthropic API)';

  constructor(private apiKey: string, private model = 'claude-haiku-4-5-20251001') {}

  get connected() {
    return Boolean(this.apiKey);
  }

  async complete(system: string, prompt: string): Promise<string | null> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          system,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`anthropic ${res.status}`);
      const data: any = await res.json();
      return (data?.content ?? []).map((b: { text?: string }) => b.text ?? '').join('').trim() || null;
    } catch (e) {
      console.warn('[llm:claude] failed, falling back to rule engine', e);
      return null;
    }
  }

  async analyzeOpportunity(input: {
    name: string;
    category: string;
    snippets: string[];
  }): Promise<Partial<LLMOpportunityAnalysis> | null> {
    const raw = await this.complete(
      'You are a rigorous, skeptical small-business research analyst. Never present marketing claims as fact. Mark uncertain evidence accordingly.',
      `Analyze this income model: "${input.name}" (category: ${input.category}).\n\nEvidence from the open web:\n${input.snippets
        .slice(0, 6)
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n')}\n\n${ANALYSIS_SCHEMA_HINT}`,
    );
    if (!raw) return null;
    try {
      return extractJson(raw) as Partial<LLMOpportunityAnalysis>;
    } catch {
      return null;
    }
  }

  async analyzeProspect(input: {
    businessName: string;
    category: string;
    location: string;
    snippets: string[];
  }): Promise<Partial<ProspectIntelligenceAnalysis> | null> {
    const raw = await this.complete(
      'You are a careful small-business researcher preparing a real sales team to talk to a REAL business. Never invent a fact this business hasn\'t evidenced. Say plainly when the evidence is thin.',
      `Research this specific business: "${input.businessName}" (${input.category}, ${input.location}).\n\nSearch snippets about THIS business:\n${input.snippets
        .slice(0, 8)
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n')}\n\n${PROSPECT_SCHEMA_HINT}`,
    );
    if (!raw) return null;
    try {
      return extractJson(raw) as Partial<ProspectIntelligenceAnalysis>;
    } catch {
      return null;
    }
  }

  async analyzeMarketPrice(input: {
    service: string;
    region: string;
    snippets: string[];
  }): Promise<Partial<MarketPriceAnalysis> | null> {
    const raw = await this.complete(
      'You are a careful pricing researcher. Only use real going-rate figures actually present in the provided snippets — never estimate from general theory or knowledge when the snippets lack a real number.',
      `What do people actually charge for "${input.service}" in ${input.region}?\n\nSearch snippets:\n${input.snippets
        .slice(0, 8)
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n')}\n\n${MARKET_PRICE_SCHEMA_HINT}`,
    );
    if (!raw) return null;
    try {
      return extractJson(raw) as Partial<MarketPriceAnalysis>;
    } catch {
      return null;
    }
  }
}

/* ------------------------------- OpenAI ----------------------------------- */

class OpenAIProvider implements LLMProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI API';

  constructor(private apiKey: string, private model = 'gpt-4o-mini') {}

  get connected() {
    return Boolean(this.apiKey);
  }

  async complete(system: string, prompt: string): Promise<string | null> {
    try {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: this.model,
          max_tokens: 1024,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: prompt },
          ],
        }),
      });
      if (!res.ok) throw new Error(`openai ${res.status}`);
      const data: any = await res.json();
      return data?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (e) {
      console.warn('[llm:openai] failed, falling back to rule engine', e);
      return null;
    }
  }

  async analyzeOpportunity(input: {
    name: string;
    category: string;
    snippets: string[];
  }): Promise<Partial<LLMOpportunityAnalysis> | null> {
    const raw = await this.complete(
      'You are a rigorous, skeptical small-business research analyst. Never present marketing claims as fact. Mark uncertain evidence accordingly.',
      `Analyze this income model: "${input.name}" (category: ${input.category}).\n\nEvidence from the open web:\n${input.snippets
        .slice(0, 6)
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n')}\n\n${ANALYSIS_SCHEMA_HINT}`,
    );
    if (!raw) return null;
    try {
      return extractJson(raw) as Partial<LLMOpportunityAnalysis>;
    } catch {
      return null;
    }
  }

  async analyzeProspect(input: {
    businessName: string;
    category: string;
    location: string;
    snippets: string[];
  }): Promise<Partial<ProspectIntelligenceAnalysis> | null> {
    const raw = await this.complete(
      'You are a careful small-business researcher preparing a real sales team to talk to a REAL business. Never invent a fact this business hasn\'t evidenced. Say plainly when the evidence is thin.',
      `Research this specific business: "${input.businessName}" (${input.category}, ${input.location}).\n\nSearch snippets about THIS business:\n${input.snippets
        .slice(0, 8)
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n')}\n\n${PROSPECT_SCHEMA_HINT}`,
    );
    if (!raw) return null;
    try {
      return extractJson(raw) as Partial<ProspectIntelligenceAnalysis>;
    } catch {
      return null;
    }
  }

  async analyzeMarketPrice(input: {
    service: string;
    region: string;
    snippets: string[];
  }): Promise<Partial<MarketPriceAnalysis> | null> {
    const raw = await this.complete(
      'You are a careful pricing researcher. Only use real going-rate figures actually present in the provided snippets — never estimate from general theory or knowledge when the snippets lack a real number.',
      `What do people actually charge for "${input.service}" in ${input.region}?\n\nSearch snippets:\n${input.snippets
        .slice(0, 8)
        .map((s, i) => `[${i + 1}] ${s}`)
        .join('\n')}\n\n${MARKET_PRICE_SCHEMA_HINT}`,
    );
    if (!raw) return null;
    try {
      return extractJson(raw) as Partial<MarketPriceAnalysis>;
    } catch {
      return null;
    }
  }
}

export function createLLMProvider(keys: {
  anthropic?: string;
  openai?: string;
}): LLMProvider | null {
  if (keys.anthropic) return new AnthropicProvider(keys.anthropic);
  if (keys.openai) return new OpenAIProvider(keys.openai);
  return null;
}
