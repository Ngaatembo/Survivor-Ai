const base = process.env.SURVIVOR_PRODUCTION_URL || 'https://survivor-ai-backend.ngaatendwew.workers.dev';

async function check(path, validate, attempts = 8) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(base + path, { headers: { accept: 'application/json' }, cache: 'no-store' });
      const text = await response.text();
      let body;
      try { body = JSON.parse(text); } catch { body = null; }
      if (!response.ok) throw new Error(`${path} returned HTTP ${response.status}: ${text.slice(0, 500)}`);
      if (!body) throw new Error(`${path} did not return JSON`);
      validate(body);
      console.log(`SMOKE PASS ${path} (attempt ${attempt})`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw lastError;
}

const health = await check('/health', (body) => {
  if (body.ok !== true) throw new Error('/health ok=false');
  if (process.env.SURVIVOR_EXPECTED_BUILD_SHA && body.deployment?.commit !== process.env.SURVIVOR_EXPECTED_BUILD_SHA) {
    throw new Error(`/health served build ${body.deployment?.commit ?? 'unknown'}, expected ${process.env.SURVIVOR_EXPECTED_BUILD_SHA}`);
  }
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

await check('/payments/requests', (body) => {
  if (body.ok !== true) throw new Error('/payments/requests ok=false');
  if (!Array.isArray(body.requests)) throw new Error('/payments/requests requests is not an array');
});

await check('/payments/finivex/status', (body) => {
  if (body.ok !== true) throw new Error('/payments/finivex/status ok=false');
  if (!body.payment || typeof body.payment.configured !== 'boolean') throw new Error('/payments/finivex/status invalid payload');
});

await check('/treasury', (body) => {
  if (body.ok !== true) throw new Error('/treasury ok=false');
  if (!body.treasury || typeof body.treasury.balance !== 'number') throw new Error('/treasury missing balance');
  if (!Array.isArray(body.spendRequests)) throw new Error('/treasury spendRequests is not an array');
});

await check('/content/state', (body) => {
  if (body.ok !== true) throw new Error('/content/state ok=false');
  if (!body.state || body.state.version !== 1) throw new Error('/content/state invalid version');
  if (!Array.isArray(body.state.research)) throw new Error('/content/state research is not an array');
  if (!Array.isArray(body.state.drafts)) throw new Error('/content/state drafts is not an array');
});


async function checkPost(path, body, expectedStatus, validate) {
  const response = await fetch(base + path, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = null; }
  if (response.status !== expectedStatus) {
    throw new Error(`${path} expected HTTP ${expectedStatus}, got ${response.status}: ${text.slice(0, 500)}`);
  }
  if (!payload) throw new Error(`${path} did not return JSON`);
  validate(payload);
  console.log(`SMOKE PASS ${path} POST validation`);
}

await checkPost('/prospects/status', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/prospects/status invalid validation response');
});

await checkPost('/offers/status', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/offers/status invalid validation response');
});

await checkPost('/projects/milestone', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/projects/milestone invalid validation response');
});

await checkPost('/real-revenue', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/real-revenue invalid validation response');
});

await checkPost('/payments/requests', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/payments/requests invalid validation response');
});

await checkPost('/treasury/spend-request', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/treasury/spend-request invalid validation response');
});

await check('/actions/approvals', (body, response) => {
  if (response.status !== 401 || body.ok !== false || body.error !== 'operator authentication required') {
    throw new Error('/actions/approvals should require operator authentication');
  }
});

await check('/actions/approvals/review', (body, response) => {
  if (response.status !== 401 || body.ok !== false || body.error !== 'operator authentication required') {
    throw new Error('/actions/approvals/review should require operator authentication');
  }
}, { method: 'POST', body: { approvalId: 'smoke_fake_approval', decision: 'REJECTED' } });

await checkPost('/actions/approvals', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/actions/approvals invalid validation response');
});

await checkPost('/actions/approvals/review', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/actions/approvals/review invalid validation response');
});

await checkPost('/actions/approvals/execute', {}, 400, (body) => {
  if (body.ok !== false || typeof body.error !== 'string') throw new Error('/actions/approvals/execute invalid validation response');
});

console.log(`PRODUCTION SMOKE PASSED: ${base}`);