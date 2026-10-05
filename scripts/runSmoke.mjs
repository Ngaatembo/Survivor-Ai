// Runs every scripts/*.smoke.ts: bundle with esbuild (packages external, so
// Miniflare and node built-ins load normally), execute with node, and fail if
// any script exits non-zero. Usage: npm test  [-- name-filter]
import { build } from 'esbuild';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const filter = process.argv[2] ?? '';
const files = readdirSync('scripts').filter((f) => f.endsWith('.smoke.ts') && f.includes(filter)).sort();
// Bundles live under node_modules so external packages (miniflare, …) resolve.
mkdirSync(join('node_modules', '.cache'), { recursive: true });
const out = mkdtempSync(join('node_modules', '.cache', 'survivor-smoke-'));
const failed = [];

for (const file of files) {
  const bundle = join(out, file.replace(/\.ts$/, '.mjs'));
  await build({ entryPoints: [join('scripts', file)], bundle: true, platform: 'node', format: 'esm', packages: 'external', outfile: bundle, logLevel: 'error' });
  const started = Date.now();
  const run = spawnSync(process.execPath, [bundle], { encoding: 'utf8', timeout: 300_000 });
  const ok = run.status === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  (${((Date.now() - started) / 1000).toFixed(1)}s)`);
  if (!ok) {
    failed.push(file);
    console.log((run.stdout + run.stderr).split('\n').filter((l) => /FAIL|Error|error/.test(l)).slice(0, 15).map((l) => `      ${l}`).join('\n'));
  }
}

rmSync(out, { recursive: true, force: true });
console.log(`\n${files.length - failed.length}/${files.length} smoke test files passed`);
process.exit(failed.length ? 1 : 0);
