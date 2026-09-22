import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();

function read(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function has(text, needle) {
  return text.includes(needle);
}

function lacks(text, needle) {
  return !text.includes(needle);
}

const wrangler = read('worker/wrangler.toml');
const liveResearch = read('src/services/liveResearch.ts');
const agentEngine = read('src/engine/agentEngine.ts');
const worker = read('worker/src/index.ts');
const treasury = read('src/lib/treasury.ts');
const paymentProvider = read('worker/src/paymentProvider.ts');
const workflow = read('.github/workflows/deploy.yml');

const checks = [
  {
    name: 'production uses the Survivor D1 database',
    ok:
      has(wrangler, 'database_name = "survivor-ai"') &&
      has(wrangler, 'database_id = "d4b6f436-1a2c-4f80-86a5-3c1717408d96"') &&
      has(wrangler, 'DB_BACKEND = "d1"'),
  },
  {
    name: 'live research creates only LIVE opportunities',
    ok:
      has(liveResearch, "const dataSource: DataSource = 'LIVE';") &&
      lacks(liveResearch, "from '../data/sampleData'") &&
      lacks(liveResearch, "SAMPLE_OPPORTUNITIES"),
  },
  {
    name: 'production engine and Worker have no sample-data imports',
    ok:
      lacks(agentEngine, 'sampleData') &&
      lacks(agentEngine, 'SAMPLE_OPPORTUNITIES') &&
      lacks(worker, 'sampleData') &&
      lacks(worker, 'SAMPLE_OPPORTUNITIES'),
  },
  {
    name: 'real-money treasury execution is hard-disabled',
    ok:
      has(treasury, 'realMoneyExecutionEnabled: false') &&
      has(treasury, 'if (snapshot.policy.emergencyFrozen || !snapshot.policy.realMoneyExecutionEnabled) return \'BLOCKED\';') &&
      has(worker, 'realMoneyExecutionEnabled: false') &&
      has(worker, 'productionExecutionEnabled: false'),
  },
  {
    name: 'EcoCash sandbox confirmations cannot become ledger revenue',
    ok:
      has(worker, "event_type = 'SANDBOX_PAYMENT_CONFIRMED'") &&
      has(worker, "INSERT OR IGNORE INTO payment_provider_events") &&
      lacks(paymentProvider, "production execution enabled"),
  },
  {
    name: 'manual cycle execution requires the trigger secret',
    ok:
      has(worker, "req.headers.get('x-trigger-secret')") &&
      has(worker, "if (!env.TRIGGER_SECRET || secret !== env.TRIGGER_SECRET)") &&
      has(worker, "if (url.pathname === '/cycles/run' && req.method === 'POST')"),
  },
  {
    name: 'deployment does not expose frontend provider secrets',
    ok:
      lacks(workflow, 'VITE_TAVILY_API_KEY') &&
      lacks(workflow, 'VITE_BRAVE_API_KEY') &&
      lacks(workflow, 'VITE_ANTHROPIC_API_KEY') &&
      lacks(workflow, 'VITE_OPENAI_API_KEY'),
  },
  {
    name: 'EcoCash adapter refuses production payment execution',
    ok:
      has(paymentProvider, "EcoCash payment execution is restricted to the sandbox endpoint") &&
      has(paymentProvider, "EcoCash transaction lookup is restricted to the sandbox endpoint"),
  },
  {
    name: 'cron trigger is configured and handled by the Worker',
    ok:
      has(wrangler, 'crons = ["*/30 * * * *"]') &&
      has(worker, 'async scheduled(') &&
      has(worker, "await engine.runCycle({ useLive: true, stepDelay: 0 });"),
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
