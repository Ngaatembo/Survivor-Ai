/* ============================================================================
 * Connector registry — static descriptions + dynamic live status.
 * The base list never changes; getConnectors() computes `connected` from
 * the providers actually wired in the running environment (browser env vars
 * or worker secrets). UI renders whatever this returns — nothing is faked.
 * ========================================================================== */

import type { ConnectorStatus } from '../types';

const BASE: Omit<ConnectorStatus, 'connected'>[] = [
  {
    id: 'supabase',
    name: 'Supabase (database)',
    purpose: 'Persistent storage for agents, opportunities, experiments, memory',
    currentFallback: 'Browser localStorage via storage adapter',
  },
  {
    id: 'search',
    name: 'Web Search API',
    purpose: 'Live opportunity discovery and source verification',
    currentFallback: 'No live results — production never falls back to SAMPLE data',
  },
  {
    id: 'claude',
    name: 'Claude API',
    purpose: 'Reasoning, opportunity analysis, report writing',
    currentFallback: 'Local deterministic rule engine',
  },
  {
    id: 'openai',
    name: 'OpenAI API',
    purpose: 'Alternative reasoning / analysis model',
    currentFallback: 'Not used — rule engine only',
  },
  {
    id: 'browser',
    name: 'Browser automation',
    purpose: 'Verify listings, prices, platforms at first hand',
    currentFallback: 'Manual verification queue (not executed)',
  },
  {
    id: 'market-data',
    name: 'Market data feeds',
    purpose: 'Prices, rates, FX for finance research category',
    currentFallback: 'None — finance category is research-only',
  },
  {
    id: 'email',
    name: 'Email / outreach',
    purpose: 'Send proposals and follow-ups (approval-gated)',
    currentFallback: 'Experiments simulated end-to-end',
  },
  {
    id: 'business-apis',
    name: 'Business APIs (marketplaces, CRM)',
    purpose: 'List products, track orders, manage leads',
    currentFallback: 'Simulated records only',
  },
  {
    id: 'cloudflare-workers',
    name: 'Cloudflare Workers',
    purpose: 'Scheduled autonomous loop execution 24/7',
    currentFallback: 'Loop runs in-browser when started',
  },
  {
    id: 'payments',
    name: 'Payment systems / real money',
    purpose: 'Real transactions — FUTURE, behind explicit authorization',
    currentFallback: 'DISABLED by safety policy — all money simulated',
    safetyGated: true,
  },
];

export interface ConnectionState {
  supabase?: boolean;
  search?: boolean;
  llmClaude?: boolean;
  llmOpenai?: boolean;
  browser?: boolean;
  email?: boolean;
  marketData?: boolean;
  workers?: boolean;
}

export function getConnectors(state: ConnectionState = {}): ConnectorStatus[] {
  return BASE.map((c) => {
    let connected = false;
    switch (c.id) {
      case 'supabase':
        connected = Boolean(state.supabase);
        break;
      case 'search':
        connected = Boolean(state.search);
        break;
      case 'claude':
        connected = Boolean(state.llmClaude);
        break;
      case 'openai':
        connected = Boolean(state.llmOpenai);
        break;
      case 'browser':
        connected = Boolean(state.browser);
        break;
      case 'email':
        connected = Boolean(state.email);
        break;
      case 'market-data':
        connected = Boolean(state.marketData);
        break;
      case 'cloudflare-workers':
        connected = Boolean(state.workers);
        break;
      case 'payments':
        connected = false; // never auto-connected; hard-gated
        break;
    }
    return { ...c, connected };
  });
}

/** Static default — used before any runtime detection. */
export const CONNECTORS: ConnectorStatus[] = getConnectors({});

export function isConnected(id: string, state?: ConnectionState): boolean {
  return getConnectors(state).find((c) => c.id === id)?.connected ?? false;
}
