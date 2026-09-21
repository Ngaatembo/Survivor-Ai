export interface Env {
  DB: D1Database;
  DB_BACKEND?: 'd1' | 'supabase';

  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  AGENT_ID?: string;

  // EcoCash credentials are Worker-only. Never expose these to the browser.
  ECOCASH_BASE_URL?: string;
  ECOCASH_CLIENT_ID?: string;
  ECOCASH_CLIENT_SECRET?: string;
  ECOCASH_WEBHOOK_SECRET?: string;

  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  TAVILY_API_KEY?: string;
  BRAVE_API_KEY?: string;

  TRIGGER_SECRET?: string;
}
