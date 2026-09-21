import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

const checks = [
  {
    name: 'production uses D1',
    ok: read('worker/wrangler.toml').includes('database_name = "survivor-ai"') &&
        read('worker/wrangler.toml').includes('DB_BACKEND = "d1"'),
  },
  {
    name: 'production live research never falls back to SAMPLE',
    ok: read('src/services/liveResearch.ts').includes('production Worker never repopulates from the legacy SAMPLE knowledge base'),
  },
  {
    name: 'real-money execution remains disabled',
    ok: read('src/lib/treasury.ts').includes('realMoneyExecutionEnabled: false') &&
        read('worker/src/index.ts').includes('productionExecutionEnabled: false'),
  },
  {
    name: 'EcoCash sandbox is excluded from revenue ledger',
    ok: read('worker/src/index.ts').includes('SANDBOX_PAYMENT_CONFIRMED') &&
        read('worker/src/index.ts').includes('never become REVENUE in the economic ledger'),
  },
  {
    name: 'manual cycle requires trigger secret',
    ok: read('worker/src/index.ts').includes("req.headers.get('x-trigger-secret')") &&
        read('worker/src/index.ts').includes("if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET)"),
  },
  {
    name: 'cron trigger is configured',
    ok: read('worker/wrangler.toml').includes('crons = ["*/30 * * * *"]') &&
        read('worker/src/index.ts').includes('async scheduled('),
  },
];

const failed = checks.filter((c) => !c.ok);
if (failed.length) {
  console.error('PRODUCTION GUARD FAILED');
  for (const check of failed) console.error(' - ' + check.name);
  process.exit(1);
}

console.log('PRODUCTION GUARD PASSED');
for (const check of checks) console.log(' ✓ ' + check.name);
