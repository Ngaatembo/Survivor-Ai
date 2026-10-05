/* ============================================================================
 * Worker route policy — one auditable table of who may call what.
 * ----------------------------------------------------------------------------
 * index.ts calls enforceRoutePolicy() before any handler runs, so access is
 * decided server-side in one place even if a handler forgets its own check
 * (handlers keep their existing checks as a second layer).
 *
 * Access levels
 *   PUBLIC    no credentials (liveness, prospect-facing demo pages, login)
 *   WEBHOOK   no session, but the handler verifies the provider (HMAC
 *             signature, or re-fetching the payment from the provider)
 *   OPERATOR  Bearer session from POST /auth/login
 *   ADMIN     x-admin-secret (ADMIN_SECRET, else TRIGGER_SECRET) — run
 *             lifecycle, kill-switch release, policy, maintenance
 * Any path under a known API prefix that is not listed is OPERATOR.
 *
 * Risk flags
 *   paid      can spend AI/search credits → rate limited + metered + kill switch
 *   financial moves or records money → kill switch
 *   external  causes an effect outside Survivor (payment links, charges)
 * ========================================================================== */

export type Access = 'PUBLIC' | 'WEBHOOK' | 'OPERATOR' | 'ADMIN';

export interface RoutePolicy {
  method: string;
  path: string;
  /** Prefix match instead of exact match. */
  prefix?: boolean;
  access: Access;
  paid?: boolean;
  financial?: boolean;
  external?: boolean;
  note?: string;
}

export const ROUTE_POLICIES: RoutePolicy[] = [
  // public
  { method: 'GET', path: '/health', access: 'PUBLIC', note: 'liveness and schema readiness; no balance, no PII' },
  { method: 'POST', path: '/auth/login', access: 'PUBLIC', note: 'rate limited per client IP' },
  { method: 'GET', path: '/demo/', prefix: true, access: 'PUBLIC', note: 'demo page built for one prospect, shared with that business by link' },
  // webhooks
  { method: 'POST', path: '/payments/finivex/webhook', access: 'WEBHOOK', note: 'status re-fetched from Finivex before any update; never moves the ledger' },
  { method: 'POST', path: '/payments/ecocash/webhook', access: 'WEBHOOK', note: 'HMAC signature verified; sandbox only' },
  // admin
  { method: 'POST', path: '/cycles/run', access: 'ADMIN', paid: true },
  { method: 'POST', path: '/runs', access: 'ADMIN', financial: true, note: 'creates a run with its starting capital (the only way capital enters)' },
  { method: 'POST', path: '/runs/end', access: 'ADMIN', financial: true },
  { method: 'POST', path: '/control/kill-switch/release', access: 'ADMIN' },
  { method: 'POST', path: '/treasury/policy', access: 'ADMIN', financial: true },
  { method: 'POST', path: '/admin/', prefix: true, access: 'ADMIN' },
  // operator — paid
  { method: 'POST', path: '/income/research', access: 'OPERATOR', paid: true },
  { method: 'POST', path: '/income/strategy', access: 'OPERATOR', paid: true },
  { method: 'POST', path: '/prospects/discover', access: 'OPERATOR', paid: true },
  { method: 'POST', path: '/prospects/verify', access: 'OPERATOR', paid: true },
  { method: 'POST', path: '/prospects/research', access: 'OPERATOR', paid: true },
  { method: 'POST', path: '/prospects/research/full', access: 'OPERATOR', paid: true },
  // operator — financial / external
  { method: 'POST', path: '/control/kill-switch/engage', access: 'OPERATOR', note: 'any operator may stop Survivor; only admin may restart it' },
  { method: 'POST', path: '/real-revenue', access: 'OPERATOR', financial: true, note: 'records a revenue CLAIM; never credits the ledger' },
  { method: 'POST', path: '/real-revenue/verify-finivex', access: 'OPERATOR', financial: true, note: 'credits the ledger only from a provider-confirmed payment' },
  { method: 'POST', path: '/treasury/', prefix: true, access: 'OPERATOR', financial: true },
  { method: 'POST', path: '/payments/', prefix: true, access: 'OPERATOR', financial: true },
  { method: 'POST', path: '/payments/finivex/create-approved-link', access: 'OPERATOR', financial: true, external: true },
  { method: 'POST', path: '/payments/finivex/payment-link', access: 'OPERATOR', financial: true, external: true },
  { method: 'POST', path: '/payments/ecocash/sandbox-charge', access: 'OPERATOR', financial: true, external: true },
  { method: 'POST', path: '/actions/approvals/execute', access: 'OPERATOR', external: true },
];

/** Paths that belong to the API. Anything else is a static dashboard asset. */
export const API_PREFIXES = [
  '/auth', '/sales', '/admin', '/integrations', '/payments', '/health', '/status', '/state', '/income',
  '/actions', '/content', '/prospects', '/offers', '/outreach', '/demo', '/projects', '/real-revenue',
  '/treasury', '/survival-challenge', '/cycles', '/runs', '/ledger', '/control',
];

function matches(p: RoutePolicy, method: string, path: string): boolean {
  if (p.method !== method) return false;
  return p.prefix ? path.startsWith(p.path) : path === p.path;
}

export function isApiPath(path: string): boolean {
  return API_PREFIXES.some((prefix) => path === prefix || path.startsWith(prefix + '/'));
}

/** Most specific policy wins (exact before prefix, longer prefix first). */
export function routePolicy(method: string, path: string): RoutePolicy | null {
  const candidates = ROUTE_POLICIES.filter((p) => matches(p, method, path)).sort((a, b) => {
    if (Boolean(a.prefix) !== Boolean(b.prefix)) return a.prefix ? 1 : -1;
    return b.path.length - a.path.length;
  });
  if (candidates[0]) return candidates[0];
  if (isApiPath(path)) return { method, path, access: 'OPERATOR' };
  return null;
}

/** Constant-time string comparison (avoids leaking the secret by timing). */
export function safeEqual(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

export interface SecretEnv {
  TRIGGER_SECRET?: string;
  ADMIN_SECRET?: string;
}

export function adminSecret(env: SecretEnv): string | undefined {
  return env.ADMIN_SECRET || env.TRIGGER_SECRET || undefined;
}

/** Admin credential: x-admin-secret, or the legacy x-trigger-secret header. */
export function isAdminRequest(req: Request, env: SecretEnv): boolean {
  const secret = adminSecret(env);
  if (!secret) return false;
  return safeEqual(req.headers.get('x-admin-secret'), secret) || safeEqual(req.headers.get('x-trigger-secret'), secret);
}

/* ------------------------------ rate limiting ------------------------------ */

export interface KvLike {
  getKV(key: string): Promise<string | null>;
  setKV(key: string, value: string): Promise<void>;
}

/**
 * Fixed-window counter in kv_store. Read-modify-write is not atomic, so two
 * simultaneous requests can both pass at the boundary; the limit is a brake
 * on abuse and runaway loops, while the cost meter's caps are the hard
 * money limit.
 */
export async function takeRateLimit(
  kv: KvLike,
  bucket: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<{ allowed: boolean; remaining: number; retryAfterSeconds: number }> {
  const key = `ratelimit:${bucket}`;
  const windowStart = Math.floor(now / windowMs) * windowMs;
  let state = { windowStart, count: 0 };
  try {
    const raw = await kv.getKV(key);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed && parsed.windowStart === windowStart && Number.isFinite(parsed.count)) state = parsed;
  } catch {
    // unreadable counter: start a fresh window
  }
  const retryAfterSeconds = Math.ceil((windowStart + windowMs - now) / 1000);
  if (state.count >= limit) return { allowed: false, remaining: 0, retryAfterSeconds };
  state.count += 1;
  await kv.setKV(key, JSON.stringify(state));
  return { allowed: true, remaining: limit - state.count, retryAfterSeconds };
}
