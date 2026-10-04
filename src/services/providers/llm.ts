/* ============================================================================
 * LLM providers — Anthropic (Claude), OpenAI and Google Gemini.
 * Pure fetch: works in browser and in Cloudflare Workers. Each method fails
 * soft (returns null) so the engine falls back to the rule engine.
 *
 * Every call goes through complete(), which asks the attached CostMeter first
 * (kill switch, run status, funds above the death threshold, daily/session
 * caps) and records the real token cost afterwards as its own line item, so
 * the AI is paid for out of the run's ledger (see lib/costMeter.ts).
 * With requireMeter (the Worker sets it) a call with no meter attached is
 * refused instead of running unaccounted.
 * ========================================================================== */

import type { LLMOpportunityAnalysis, LLMProvider, MarketPriceAnalysis, ProspectIntelligenceAnalysis } from './types';
import { CostMeter, DEFAULT_LLM_PRICING, estimateLlmCostUsd, llmCostUsd, type LlmPricing } from '../../lib/costMeter';

const MAX_OUTPUT_TOKENS = 1024;

const ANALYSIS_SCHEMA_HINT = `Return ONLY minified JSON with this shape:
{"name":string,"category":"Digital Business|Content|E-Commerce|Services|Finance|Local / Real-World","howMoneyMade":string,"capitalRequiredMin":number,"capitalRequiredMax":number,
"timeToRevenueDaysMin":number,"timeToRevenueDaysMax":number,"skills":string[],
"difficulty":1-5,"competition":1-5,"scalability":1-5,"risk":1-5,
"successProbability":0-1,"revenuePotentialMonthlyMin":number,
"revenuePotentialMonthlyMax":number,
"evidenceTier":"VERIFIED|LIKELY|UNCERTAIN|UNVERIFIED",
"evidenceNotes":string,"upsideNote":string,"downsideNote":string,
"operatingCostsNote":string,"examples":string[],"summary":string}
Conservative, realistic numbers for a beginner with ~$50. If sources are weak,
use UNCERTAIN/UNVERIFIED. No prose outside the JSON.`;

const PROSPECT_SCHEMA_HINT = `Return ONLY minified JSON with this shape:\n{"businessOverview":string,"apparentServices":string[],"socialPresenceSummary":string,"competitiveNote":string,"specificProblemEvidence":string,"recommendedAngle":string,"problemCandidates":[{"type":"DISCOVERABILITY|TRUST|CONVERSION|BOOKING|ORDERING|LEAD_CAPTURE|FOLLOW_UP|CUSTOMER_EXPERIENCE|COMPETITIVE_POSITION|WEBSITE_QUALITY|OTHER","evidence":string,"businessFriction":string,"likelyConsequence":string,"solvableOpportunity":string,"outreachClaim":string,"confidence":"HIGH|MEDIUM|LOW","sourceIds":string[]}],"primaryProblem":null,"confidence":"HIGH|MEDIUM|LOW"}\nReason in this order: OBSERVATION -> FRICTION -> CONSEQUENCE -> OPPORTUNITY -> OUTREACH CLAIM. Return 1-3 candidate problems when evidence supports them; do not manufacture candidates. Prefer one strong evidenced problem over many weak ones. A missing feature alone is not a business problem. Never invent metrics, lost sales, customer complaints, motives, or competitor superiority. Distinguish facts from reasonable inferences. sourceIds must be the numeric snippet references as strings, e.g. ["1"] or ["2","4"]. If no sufficiently evidenced business-specific problem exists, return problemCandidates as [] and primaryProblem as null and confidence to LOW. No prose outside the JSON.`;

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

/* ------------------------------ shared base -------------------------------- */

interface RawCompletion {
  text: string | null;
  inputTokens: number;
  outputTokens: number;
}

abstract class MeteredProvider implements LLMProvider {
  abstract readonly id: string;
  abstract readonly label: string;
  private meter: CostMeter | null = null;

  constructor(
    protected apiKey: string,
    protected model: string,
    protected pricing: LlmPricing,
    private requireMeter = false,
  ) {}

  get connected() {
    return Boolean(this.apiKey);
  }

  attachMeter(meter: CostMeter | null): void {
    this.meter = meter;
  }

  /** One raw API call. Returns null on any failure. */
  protected abstract callApi(system: string, prompt: string): Promise<RawCompletion | null>;

  async complete(system: string, prompt: string): Promise<string | null> {
    const meter = this.meter;
    if (!meter && this.requireMeter) {
      console.warn(`[llm:${this.id}] refused: no cost meter attached (unaccounted AI calls are not allowed here)`);
      return null;
    }
    const estimate = estimateLlmCostUsd(this.pricing, system.length + prompt.length, MAX_OUTPUT_TOKENS);
    if (meter) {
      const check = await meter.authorize(estimate);
      if (!check.ok) return null; // kill switch, dead run, no funds or cap → rule-engine fallback
    }
    try {
      const raw = await this.callApi(system, prompt);
      if (!raw) return null;
      meter?.recordLlm(llmCostUsd(this.pricing, raw.inputTokens, raw.outputTokens), raw.inputTokens, raw.outputTokens, {
        provider: `${this.id}:${this.model}`,
        operation: 'completion',
        estimatedUsd: estimate,
      });
      return raw.text?.trim() || null;
    } catch (e) {
      console.warn(`[llm:${this.id}] failed, falling back to rule engine`, e);
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
      `Analyze this income model or open-ended opportunity scan: "${input.name}" (category hint: ${input.category}). If the evidence reveals a different concrete opportunity, name it and classify it accordingly. Never force the evidence into the supplied category.\n\nEvidence from the open web:\n${input.snippets
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

/* ------------------------------ Anthropic --------------------------------- */

class AnthropicProvider extends MeteredProvider {
  readonly id = 'claude';
  readonly label = 'Claude (Anthropic API)';

  protected async callApi(system: string, prompt: string): Promise<RawCompletion | null> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        system,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`anthropic ${res.status}`);
    const data: any = await res.json();
    return {
      text: (data?.content ?? []).map((b: { text?: string }) => b.text ?? '').join(''),
      inputTokens: Number(data?.usage?.input_tokens ?? 0),
      outputTokens: Number(data?.usage?.output_tokens ?? 0),
    };
  }
}

/* ------------------------------- OpenAI ----------------------------------- */

class OpenAIProvider extends MeteredProvider {
  readonly id = 'openai';
  readonly label = 'OpenAI API';

  protected async callApi(system: string, prompt: string): Promise<RawCompletion | null> {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_OUTPUT_TOKENS,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!res.ok) throw new Error(`openai ${res.status}`);
    const data: any = await res.json();
    return {
      text: data?.choices?.[0]?.message?.content ?? null,
      inputTokens: Number(data?.usage?.prompt_tokens ?? 0),
      outputTokens: Number(data?.usage?.completion_tokens ?? 0),
    };
  }
}

/* ------------------------------- Gemini ----------------------------------- */

class GeminiProvider extends MeteredProvider {
  readonly id = 'gemini';
  readonly label = 'Gemini (Google AI API)';

  protected async callApi(system: string, prompt: string): Promise<RawCompletion | null> {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model)}:generateContent`,
      {
        method: 'POST',
        headers: { 'x-goog-api-key': this.apiKey, 'content-type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: { maxOutputTokens: MAX_OUTPUT_TOKENS },
        }),
      },
    );
    if (!res.ok) throw new Error(`gemini ${res.status}`);
    const data: any = await res.json();
    const parts: { text?: string }[] = data?.candidates?.[0]?.content?.parts ?? [];
    return {
      text: parts.map((p) => p.text ?? '').join(''),
      inputTokens: Number(data?.usageMetadata?.promptTokenCount ?? 0),
      outputTokens: Number(data?.usageMetadata?.candidatesTokenCount ?? 0) + Number(data?.usageMetadata?.thoughtsTokenCount ?? 0),
    };
  }
}

export function createLLMProvider(keys: {
  anthropic?: string;
  openai?: string;
  gemini?: string;
  model?: string;
  inputUsdPerMTok?: number;
  outputUsdPerMTok?: number;
  /** Refuse any call made without an attached CostMeter. */
  requireMeter?: boolean;
}): LLMProvider | null {
  const strict = Boolean(keys.requireMeter);
  const price = (base: LlmPricing): LlmPricing => ({
    inputUsdPerMTok: Number.isFinite(keys.inputUsdPerMTok) ? keys.inputUsdPerMTok! : base.inputUsdPerMTok,
    outputUsdPerMTok: Number.isFinite(keys.outputUsdPerMTok) ? keys.outputUsdPerMTok! : base.outputUsdPerMTok,
  });
  if (keys.anthropic) return new AnthropicProvider(keys.anthropic, keys.model || 'claude-haiku-4-5-20251001', price(DEFAULT_LLM_PRICING.claude), strict);
  if (keys.openai) return new OpenAIProvider(keys.openai, keys.model || 'gpt-4o-mini', price(DEFAULT_LLM_PRICING.openai), strict);
  if (keys.gemini) return new GeminiProvider(keys.gemini, keys.model || 'gemini-2.5-flash', price(DEFAULT_LLM_PRICING.gemini), strict);
  return null;
}
