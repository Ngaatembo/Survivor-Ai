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
  // Base URL of the deployed Cloudflare Worker backend (e.g.
  // https://survivor-ai-backend.<subdomain>.workers.dev). When set, the
  // dashboard treats the backend/D1 as the sole source of truth for agent,
  // wallet, opportunity, experiment, memory and activity data, and the local
  // browser autonomous loop is disabled (see store.ts) — there must never be
  // two independent sources of truth for the same simulated business state.
  // When unset, the app falls back to the original standalone browser demo
  // (localStorage + local rule engine), clearly labeled as DEMO in the UI.
  apiBaseUrl: pick(import.meta.env?.VITE_API_BASE_URL).replace(/\/+$/, ''),
};

export const featureFlags = {
  supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
  llm: Boolean(env.anthropicKey || env.openaiKey),
  search: Boolean(env.tavilyKey || env.braveKey),
  liveResearch: Boolean(
    (env.anthropicKey || env.openaiKey) && (env.tavilyKey || env.braveKey),
  ),
  backend: Boolean(env.apiBaseUrl),
};
