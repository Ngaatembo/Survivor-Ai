export interface Env {
  DB: D1Database;
  DB_BACKEND?: 'd1' | 'supabase';

  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  AGENT_ID?: string;
  BUILD_SHA?: string;

  // EcoCash credentials/configuration are Worker-only. Never expose these to the browser.
  // EIP sandbox currently uses HTTP Basic Auth.
  ECOCASH_BASE_URL?: string;
  ECOCASH_USERNAME?: string;
  ECOCASH_PASSWORD?: string;
  ECOCASH_MERCHANT_CODE?: string;
  ECOCASH_MERCHANT_PIN?: string;
  ECOCASH_MERCHANT_NUMBER?: string;
  ECOCASH_WEBHOOK_SECRET?: string;
  // Legacy names retained so older deployments remain type-compatible.
  ECOCASH_CLIENT_ID?: string;
  ECOCASH_CLIENT_SECRET?: string;

  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  /** Google Gemini API key — free tier works without billing. */
  GEMINI_API_KEY?: string;
  /** Optional model override for whichever LLM key is set. */
  LLM_MODEL?: string;
  /** Optional price overrides (USD per million tokens) for the treasury's cost meter. */
  LLM_INPUT_USD_PER_MTOK?: string;
  LLM_OUTPUT_USD_PER_MTOK?: string;
  /** Per-query search price for every provider (USD). When unset, each
   *  provider's list price applies (lib/costMeter.ts DEFAULT_SEARCH_PRICE_USD). */
  SEARCH_COST_PER_QUERY_USD?: string;
  TAVILY_COST_PER_QUERY_USD?: string;
  BRAVE_COST_PER_QUERY_USD?: string;
  /** Optional override of the $0.40/day automatic AI + search spending cap. */
  DAILY_SPEND_CAP_USD?: string;
  /** Operator-triggered paid research: daily cap (default $1.00), per-request
   *  cap (default $0.25) and requests per hour (default 30). */
  MANUAL_DAILY_CAP_USD?: string;
  MANUAL_PER_REQUEST_CAP_USD?: string;
  MANUAL_PAID_REQUESTS_PER_HOUR?: string;
  TAVILY_API_KEY?: string;
  BRAVE_API_KEY?: string;

  /** Operator password (POST /auth/login) and legacy admin credential. */
  TRIGGER_SECRET?: string;
  /** Separate admin credential (x-admin-secret) for run lifecycle, kill-switch
   *  release and maintenance. Falls back to TRIGGER_SECRET when unset. */
  ADMIN_SECRET?: string;

  // Finivex merchant credentials are Worker-only. Never expose the API secret to the browser.
  FINIVEX_BASE_URL?: string;
  FINIVEX_API_KEY?: string;
  FINIVEX_API_SECRET?: string;

  // Windsor.ai server-side API key. Never expose this to the browser.
  WINDSOR_API_KEY?: string;
  WINDSOR_BASE_URL?: string;
  WINDSOR_SEARCHCONSOLE_ACCOUNT_ID?: string;
  WINDSOR_GA4_ACCOUNT_ID?: string;
  WINDSOR_FACEBOOK_ACCOUNT_ID?: string;
  WINDSOR_INSTAGRAM_ACCOUNT_ID?: string;
  WINDSOR_TIKTOK_ACCOUNT_ID?: string;
  WINDSOR_YOUTUBE_ACCOUNT_ID?: string;
  WINDSOR_LINKEDIN_ACCOUNT_ID?: string;

  // Cloudflare Workers Static Assets binding for the production dashboard.
  ASSETS: Fetcher;
}
