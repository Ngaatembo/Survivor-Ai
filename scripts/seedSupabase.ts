/* ============================================================================
 * Seed the SAMPLE knowledge base into Supabase.
 *
 *   node --env-file=.env scripts/seedSupabase.ts   (run via the npm script)
 *
 * Requires:
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (or the VITE_/SUPABASE_ names)
 * Idempotent: safe to run repeatedly (upserts on primary keys).
 * ========================================================================== */

import { createClient } from '@supabase/supabase-js';
import { SupabaseRepository, seedSupabase } from '../src/engine/supabaseRepository';
import { AGENT_ID } from '../src/engine/seed';

async function main() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. See .env.example.');
    process.exit(1);
  }

  const db = createClient(url, key, { auth: { persistSession: false } });
  console.log('Seeding agent + SAMPLE opportunities into Supabase…');
  await seedSupabase(db as any, process.env.AGENT_ID || AGENT_ID);

  const repo = new SupabaseRepository(db as any, process.env.AGENT_ID || AGENT_ID);
  const [opps, txs, events] = await Promise.all([
    repo.listOpportunities(),
    repo.listTransactions(),
    repo.listEvents(),
  ]);
  console.log(
    `Done. ${opps.length} opportunities (${opps.filter((o) => o.dataSource === 'LIVE').length} live), ${txs.length} transactions, ${events.length} events.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
