/* Local D1 (Miniflare/workerd) built from the real schema and migrations.
 * schema.d1.sql already contains some columns that early migrations add, so
 * migrations before `strictFrom` are applied tolerantly (duplicate-column
 * errors expected). Migrations from `strictFrom` on must apply cleanly —
 * a broken migration fails the test instead of being swallowed. */
import { Miniflare } from 'miniflare';
import { readFileSync, readdirSync } from 'node:fs';

function statements(sql: string): string[] {
  return sql
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(/;\s*\n/)
    .map((s) => s.trim().replace(/;$/, ''))
    .filter(Boolean);
}

export interface TestDb {
  mf: Miniflare;
  db: any;
  applyMigration(file: string, strict?: boolean): Promise<void>;
}

export async function createTestDb(opts: { strictFrom?: string; upTo?: string } = {}): Promise<TestDb> {
  const strictFrom = opts.strictFrom ?? '0021';
  const mf = new Miniflare({ modules: true, script: 'export default { fetch(){ return new Response("x") } }', d1Databases: { DB: `test-${Math.random().toString(36).slice(2)}` } });
  const db: any = await mf.getD1Database('DB');

  const applyMigration = async (file: string, strict = false) => {
    for (const stmt of statements(readFileSync(file, 'utf8'))) {
      try {
        await db.prepare(stmt).run();
      } catch (e) {
        if (strict) throw new Error(`${file}: ${(e as Error).message}\n  in: ${stmt.slice(0, 160)}`);
      }
    }
  };

  await applyMigration('schema.d1.sql');
  const files = readdirSync('migrations').filter((f) => f.endsWith('.sql')).sort();
  for (const f of files) {
    if (opts.upTo && f.slice(0, 4) > opts.upTo) break;
    await applyMigration(`migrations/${f}`, f.slice(0, 4) >= strictFrom);
  }
  return { mf, db, applyMigration };
}
