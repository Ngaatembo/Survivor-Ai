/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_ANTHROPIC_API_KEY?: string;
  readonly VITE_OPENAI_API_KEY?: string;
  readonly VITE_TAVILY_API_KEY?: string;
  readonly VITE_BRAVE_API_KEY?: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
