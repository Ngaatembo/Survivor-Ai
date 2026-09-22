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
  TAVILY_API_KEY?: string;
  BRAVE_API_KEY?: string;

  TRIGGER_SECRET?: string;

  // Finivex merchant credentials are Worker-only. Never expose the API secret to the browser.
  FINIVEX_BASE_URL?: string;
  FINIVEX_API_KEY?: string;
  FINIVEX_API_SECRET?: string;
}
