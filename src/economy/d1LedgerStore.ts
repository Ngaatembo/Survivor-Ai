/* ============================================================================
 * Survivor economy — D1 persistence for runs and the ledger.
 * Tables/columns come from migrations/0022_truthful_ledger.sql, whose
 * triggers and unique indexes repeat the critical rules in the database:
 *   - one STARTING_CAPITAL per run, one open run per agent,
 *   - unique idempotency keys,
 *   - no insert into a run that is not open, no REAL entry without a run,
 *   - ledger entries cannot be updated or deleted,
 *   - DEAD / ENDED runs can never change status again.
 * ========================================================================== */

import type { D1DatabaseLike } from '../engine/d1Repository';
import type { LedgerEntry, RunStatus, SurvivorRun } from './ledger';
import { LEGACY_TYPE_FOR_KIND, OPEN_RUN_STATUSES } from './ledger';
import type { InsertResult, LedgerStore } from './ledgerStore';

const iso = (ms: number | undefined) => (ms === undefined || ms === null ? null : new Date(ms).toISOString());
const ms = (value: unknown) => (value ? Date.parse(String(value)) : undefined);

function mapRun(r: any): SurvivorRun {
  return {
    id: String(r.id),
    agentId: String(r.agent_id),
    environment: r.environment,
    status: r.status,
    currency: r.currency,
    startingCapital: Number(r.starting_capital),
    deathThreshold: Number(r.death_threshold),
    depletedThreshold: Number(r.depleted_threshold),
    label: r.label ?? undefined,
    createdAt: ms(r.created_at) ?? 0,
    startedAt: ms(r.started_at),
    diedAt: ms(r.died_at),
    endedAt: ms(r.ended_at),
    endReason: r.end_reason ?? undefined,
    createdBy: r.created_by ?? 'unknown',
  };
}

function mapEntry(r: any): LedgerEntry {
  let metadata: Record<string, unknown> = {};
  try { metadata = r.metadata ? JSON.parse(r.metadata) : {}; } catch { metadata = {}; }
  return {
    id: String(r.id),
    runId: String(r.run_id),
    agentId: String(r.agent_id),
    kind: r.kind,
    amount: Number(r.amount),
    currency: r.currency ?? 'USD',
    description: r.description,
    idempotencyKey: r.idempotency_key,
    environment: r.environment,
    recordedBy: r.recorded_by ?? 'unknown',
    metadata,
    balanceAfter: Number(r.balance_after),
    createdAt: ms(r.created_at) ?? 0,
  };
}

const OPEN_LIST = OPEN_RUN_STATUSES.map((s) => `'${s}'`).join(',');

export class D1LedgerStore implements LedgerStore {
  constructor(private db: D1DatabaseLike, private agentId: string) {}

  async getOpenRun() {
    const r = await this.db
      .prepare(`SELECT * FROM survivor_runs WHERE agent_id = ? AND status IN (${OPEN_LIST}) ORDER BY created_at DESC LIMIT 1`)
      .bind(this.agentId)
      .first();
    return r ? mapRun(r) : null;
  }

  async getLatestRun() {
    const r = await this.db
      .prepare('SELECT * FROM survivor_runs WHERE agent_id = ? ORDER BY created_at DESC LIMIT 1')
      .bind(this.agentId)
      .first();
    return r ? mapRun(r) : null;
  }

  async getRun(runId: string) {
    const r = await this.db.prepare('SELECT * FROM survivor_runs WHERE id = ? AND agent_id = ?').bind(runId, this.agentId).first();
    return r ? mapRun(r) : null;
  }

  async listRuns() {
    const { results } = await this.db
      .prepare('SELECT * FROM survivor_runs WHERE agent_id = ? ORDER BY created_at DESC')
      .bind(this.agentId)
      .all();
    return results.map(mapRun);
  }

  async insertRun(run: SurvivorRun) {
    await this.db
      .prepare(
        `INSERT INTO survivor_runs
           (id, agent_id, environment, status, currency, starting_capital, death_threshold, depleted_threshold,
            label, created_at, started_at, died_at, ended_at, end_reason, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        run.id, run.agentId, run.environment, run.status, run.currency, run.startingCapital, run.deathThreshold,
        run.depletedThreshold, run.label ?? null, iso(run.createdAt), iso(run.startedAt), iso(run.diedAt),
        iso(run.endedAt), run.endReason ?? null, run.createdBy,
      )
      .run();
  }

  async transitionRun(runId: string, from: readonly RunStatus[], patch: Partial<SurvivorRun> & { status: RunStatus }) {
    if (from.length === 0) return false;
    const sets = ['status = ?'];
    const values: unknown[] = [patch.status];
    if (patch.startedAt !== undefined) { sets.push('started_at = ?'); values.push(iso(patch.startedAt)); }
    if (patch.diedAt !== undefined) { sets.push('died_at = ?'); values.push(iso(patch.diedAt)); }
    if (patch.endedAt !== undefined) { sets.push('ended_at = ?'); values.push(iso(patch.endedAt)); }
    if (patch.endReason !== undefined) { sets.push('end_reason = ?'); values.push(patch.endReason); }
    const res: any = await this.db
      .prepare(`UPDATE survivor_runs SET ${sets.join(', ')} WHERE id = ? AND agent_id = ? AND status IN (${from.map(() => '?').join(',')})`)
      .bind(...values, runId, this.agentId, ...from)
      .run();
    return Boolean(res?.meta?.changes);
  }

  async listEntries(runId: string) {
    const { results } = await this.db
      .prepare('SELECT * FROM transactions WHERE agent_id = ? AND run_id = ? ORDER BY created_at ASC, id ASC')
      .bind(this.agentId, runId)
      .all();
    return results.map(mapEntry);
  }

  async findByIdempotencyKey(key: string) {
    const r = await this.db.prepare('SELECT * FROM transactions WHERE idempotency_key = ?').bind(key).first();
    return r ? mapEntry(r) : null;
  }

  async insertEntry(entry: LedgerEntry): Promise<InsertResult> {
    // ON CONFLICT on the unique idempotency index makes a duplicate a no-op
    // instead of an error, so concurrent retries resolve to one entry.
    const res: any = await this.db
      .prepare(
        `INSERT INTO transactions
           (id, agent_id, type, amount, description, related_experiment_id, balance_after, created_at, ledger,
            run_id, kind, idempotency_key, environment, currency, recorded_by, metadata)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, 'REAL', ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(idempotency_key) DO NOTHING`,
      )
      .bind(
        entry.id, entry.agentId, LEGACY_TYPE_FOR_KIND[entry.kind], entry.amount, entry.description,
        entry.balanceAfter, iso(entry.createdAt), entry.runId, entry.kind, entry.idempotencyKey,
        entry.environment, entry.currency, entry.recordedBy, JSON.stringify(entry.metadata ?? {}),
      )
      .run();
    return res?.meta?.changes ? 'INSERTED' : 'DUPLICATE';
  }
}
