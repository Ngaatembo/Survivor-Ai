/* ============================================================================
 * LLM providers — Anthropic (Claude) and OpenAI.
 * Pure fetch: works in browser and in Cloudflare Workers. Each method fails
 * soft (returns null) so the engine falls back to the rule engine.
 * ========================================================================== */

import type { LLMOpportunityAnalysis, LLMProvider } from './types';

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
      const data = await res.json();
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
      const data = await res.json();
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
}

export function createLLMProvider(keys: {
  anthropic?: string;
  openai?: string;
}): LLMProvider | null {
  if (keys.anthropic) return new AnthropicProvider(keys.anthropic);
  if (keys.openai) return new OpenAIProvider(keys.openai);
  return null;
}
