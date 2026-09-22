const base = process.env.SURVIVOR_PRODUCTION_URL || 'https://survivor-ai-backend.ngaatendwew.workers.dev';

async function check(path, validate) {
  const response = await fetch(base + path, { headers: { accept: 'application/json' } });
  const text = await response.text();
  let body;
  try { body = JSON.parse(text); } catch { body = null; }
  if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
  if (!body) throw new Error(`${path} did not return JSON`);
  validate(body);
  console.log(`SMOKE PASS ${path}`);
  return body;
}

const health = await check('/health', (body) => {
  if (body.ok !== true) throw new Error('/health ok=false');
  if (body.ready !== true) throw new Error(`/health not ready: ${JSON.stringify(body.schema)}`);
  if (body.connectors?.db?.connected !== true) throw new Error('production database is not connected');
  if (body.connectors?.payments?.productionExecutionEnabled !== false) throw new Error('production payment execution is not hard-disabled');
});

await check('/status', (body) => {
  if (body.ok !== true) throw new Error('/status ok=false');
  if (!body.agent || typeof body.agent.id !== 'string') throw new Error('/status missing agent');
});

await check('/state', (body) => {
  if (body.ok !== true) throw new Error('/state ok=false');
  if (!body.agent || typeof body.agent.id !== 'string') throw new Error('/state missing agent');
});

console.log(`PRODUCTION SMOKE PASSED: ${base}`);
