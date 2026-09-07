/* ============================================================================
 * Environment detection — browser side.
 * Empty/unset means "not connected" and the engine falls back to the local
 * rule engine + SAMPLE knowledge base. Never put service-role keys here.
 * ========================================================================== */

function pick(...vals: (string | undefined)[]): string {
  for (const v of vals) if (v && v.trim()) return v.trim();
  return '';
}

export const env = {
  supabaseUrl: pick(import.meta.env?.VITE_SUPABASE_URL),
  supabaseAnonKey: pick(import.meta.env?.VITE_SUPABASE_ANON_KEY),
  anthropicKey: pick(import.meta.env?.VITE_ANTHROPIC_API_KEY),
  openaiKey: pick(import.meta.env?.VITE_OPENAI_API_KEY),
  tavilyKey: pick(import.meta.env?.VITE_TAVILY_API_KEY),
  braveKey: pick(import.meta.env?.VITE_BRAVE_API_KEY),
};

export const featureFlags = {
  supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  llm: Boolean(env.anthropicKey || env.openaiKey),
  search: Boolean(env.tavilyKey || env.braveKey),
  liveResearch: Boolean(
    (env.anthropicKey || env.openaiKey) && (env.tavilyKey || env.braveKey),
  ),
};
