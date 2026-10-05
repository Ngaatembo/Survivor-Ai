/* ============================================================================
 * Survivor economy — spend gate: authorize BEFORE a paid call, atomically.
 * ----------------------------------------------------------------------------
 * reserve() is a single INSERT … SELECT … WHERE statement. The WHERE clause
 * evaluates, inside the database and at one instant, every rule a paid call
 * must pass. D1 runs writes one at a time, so five concurrent cycles cannot
 * each see "room under the daily cap" and all spend: only the reservations
 * that fit are inserted. No row → no provider request.
 *
 * settle() posts the actual cost to the run's ledger (idempotency key
 * spend:<authorizationId>) and marks the row SETTLED. release() is only for
 * calls the provider definitely did not bill. Anything uncertain stays
 * RESERVED and keeps counting against every limit.
 * ========================================================================== */

import type { D1DatabaseLike } from '../engine/d1Repository';
import { KILL_SWITCH_KEY } from './killSwitch';
import type { Treasury } from './treasury';

export type Initiator = 'SURVIVOR' | 'OPERATOR';

export interface SpendRequestLimits {
  perCallUsd: number;
  perSessionUsd: number;
  channelDailyUsd: number;
  totalDailyUsd: number;
  runwayReserveUsd: number;
}

export interface ReserveRequest {
  idempotencyKey: string;
  runId: string;
  initiatedBy: Initiator;
  channel: 'AUTO' | 'MANUAL';
  provider: string;
  operation: string;
  units: number;
  unit: string;
  amountUsd: number;
  sessionId: string;
  reason: string;
  limits: SpendRequestLimits;
}

export type ReserveRefusal =
  | 'DUPLICATE'
  | 'KILL_SWITCH'
  | 'RUN_CLOSED'
  | 'PER_CALL_CAP'
  | 'SESSION_CAP'
  | 'DAILY_CAP'
  | 'TOTAL_DAILY_CAP'
  | 'RUNWAY'
  | 'INVALID'
  | 'GATE_ERROR';

export type ReserveResult = { ok: true; id: string } | { ok: false; code: ReserveRefusal; detail: string };

export interface SpendGate {
  reserve(req: ReserveRequest): Promise<ReserveResult>;
  settle(id: string, actualUsd: number, ledger: { kind: 'AI_EXPENSE' | 'SEARCH_EXPENSE'; description: string; metadata: Record<string, unknown> }): Promise<{ ok: boolean; detail?: string }>;
  release(id: string, outcome: string): Promise<void>;
}

const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export class D1SpendGate implements SpendGate {
  constructor(
    private db: D1DatabaseLike,
    private agentId: string,
    private treasury: Treasury,
    private clock: () => number = Date.now,
  ) {}

  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    const amount = Math.round(req.amountUsd * 1_000_000) / 1_000_000;
    if (!(amount > 0) || !req.idempotencyKey || !req.runId) {
      return { ok: false, code: 'INVALID', detail: 'a reservation needs a positive amount, an idempotency key and a run' };
    }
    const now = this.clock();
    const id = `spend_${crypto.randomUUID()}`;
    const day = utcDay(now);
    const l = req.limits;
    let res: any;
    try {
      res = await this.db
        .prepare(
          `INSERT INTO spend_authorizations
             (id, agent_id, run_id, idempotency_key, initiated_by, channel, provider, operation, units, unit,
              amount_reserved, day, session_id, reason, status, created_at)
           SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'RESERVED', ?15
           WHERE
             COALESCE((SELECT json_extract(value, '$.engaged') FROM kv_store WHERE agent_id = ?2 AND key = ?16), 0) = 0
             AND EXISTS (SELECT 1 FROM survivor_runs WHERE id = ?3 AND agent_id = ?2 AND status IN ('ALIVE','DEPLETED'))
             AND ?11 <= ?17
             AND COALESCE((SELECT SUM(COALESCE(amount_actual, amount_reserved)) FROM spend_authorizations
                           WHERE session_id = ?13 AND status <> 'RELEASED'), 0) + ?11 <= ?18
             AND COALESCE((SELECT SUM(COALESCE(amount_actual, amount_reserved)) FROM spend_authorizations
                           WHERE agent_id = ?2 AND channel = ?6 AND day = ?12 AND status <> 'RELEASED'), 0) + ?11 <= ?19
             AND COALESCE((SELECT SUM(COALESCE(amount_actual, amount_reserved)) FROM spend_authorizations
                           WHERE agent_id = ?2 AND day = ?12 AND status <> 'RELEASED'), 0) + ?11 <= ?20
             AND (SELECT COALESCE(SUM(amount), 0) FROM transactions WHERE run_id = ?3)
                 - COALESCE((SELECT SUM(amount_reserved) FROM spend_authorizations WHERE run_id = ?3 AND status = 'RESERVED'), 0)
                 - ?11
                 >= (SELECT death_threshold FROM survivor_runs WHERE id = ?3) + ?21
           ON CONFLICT(idempotency_key) DO NOTHING`,
        )
        .bind(
          id, this.agentId, req.runId, req.idempotencyKey, req.initiatedBy, req.channel, req.provider, req.operation,
          req.units, req.unit, amount, day, req.sessionId, req.reason.slice(0, 300), new Date(now).toISOString(),
          KILL_SWITCH_KEY, l.perCallUsd, l.perSessionUsd, l.channelDailyUsd, l.totalDailyUsd, l.runwayReserveUsd,
        )
        .run();
    } catch (e) {
      // Fail closed: if the gate cannot decide (e.g. table missing, corrupt
      // kill-switch JSON), the call does not happen.
      return { ok: false, code: 'GATE_ERROR', detail: (e as Error).message };
    }
    if (res?.meta?.changes) return { ok: true, id };
    return { ok: false, ...(await this.explain(req, amount, day)) };
  }

  /** Why a reservation was refused (diagnostic only — the decision was the
   *  atomic INSERT above). */
  private async explain(req: ReserveRequest, amount: number, day: string): Promise<{ code: ReserveRefusal; detail: string }> {
    const dup = await this.db.prepare('SELECT id FROM spend_authorizations WHERE idempotency_key = ?').bind(req.idempotencyKey).first();
    if (dup) return { code: 'DUPLICATE', detail: `already authorized under ${req.idempotencyKey}; a retry must not call the provider again` };
    const kill: any = await this.db.prepare('SELECT value FROM kv_store WHERE agent_id = ? AND key = ?').bind(this.agentId, KILL_SWITCH_KEY).first();
    try { if (kill && JSON.parse(kill.value)?.engaged) return { code: 'KILL_SWITCH', detail: 'kill switch engaged' }; } catch { return { code: 'KILL_SWITCH', detail: 'kill switch unreadable' }; }
    const run: any = await this.db.prepare('SELECT status, death_threshold FROM survivor_runs WHERE id = ?').bind(req.runId).first();
    if (!run || !['ALIVE', 'DEPLETED'].includes(run.status)) return { code: 'RUN_CLOSED', detail: `run is ${run?.status ?? 'missing'}` };
    const l = req.limits;
    if (amount > l.perCallUsd) return { code: 'PER_CALL_CAP', detail: `$${amount} exceeds the per-call cap $${l.perCallUsd}` };
    const sum = async (where: string, ...binds: unknown[]) => Number(((await this.db.prepare(`SELECT COALESCE(SUM(COALESCE(amount_actual, amount_reserved)),0) s FROM spend_authorizations WHERE ${where} AND status <> 'RELEASED'`).bind(...binds).first()) as any)?.s ?? 0);
    if ((await sum('session_id = ?', req.sessionId)) + amount > l.perSessionUsd) return { code: 'SESSION_CAP', detail: `session cap $${l.perSessionUsd} reached` };
    if ((await sum('agent_id = ? AND channel = ? AND day = ?', this.agentId, req.channel, day)) + amount > l.channelDailyUsd) return { code: 'DAILY_CAP', detail: `${req.channel} daily cap $${l.channelDailyUsd} reached` };
    if ((await sum('agent_id = ? AND day = ?', this.agentId, day)) + amount > l.totalDailyUsd) return { code: 'TOTAL_DAILY_CAP', detail: `total daily cap $${l.totalDailyUsd} reached` };
    return { code: 'RUNWAY', detail: `the call would leave less than the death threshold + $${l.runwayReserveUsd} runway reserve` };
  }

  async settle(id: string, actualUsd: number, ledger: { kind: 'AI_EXPENSE' | 'SEARCH_EXPENSE'; description: string; metadata: Record<string, unknown> }) {
    const row: any = await this.db.prepare('SELECT * FROM spend_authorizations WHERE id = ?').bind(id).first();
    if (!row) return { ok: false, detail: 'authorization not found' };
    if (row.status !== 'RESERVED') return { ok: row.status === 'SETTLED', detail: `already ${row.status}` };
    const actual = Math.max(0, Math.round(actualUsd * 1_000_000) / 1_000_000);
    let ledgerEntryId: string | null = null;
    if (actual > 0) {
      const posted = await this.treasury.post({
        kind: ledger.kind,
        amount: -actual,
        description: ledger.description,
        idempotencyKey: `spend:${id}`,
        recordedBy: row.initiated_by === 'SURVIVOR' ? 'engine' : 'operator',
        metadata: {
          ...ledger.metadata,
          authorizationId: id,
          initiatedBy: row.initiated_by,
          channel: row.channel,
          provider: row.provider,
          operation: row.operation,
          units: row.units,
          unit: row.unit,
          estimatedUsd: row.amount_reserved,
          actualUsd: actual,
          reason: row.reason,
          status: 'POSTED',
        },
      }, row.run_id);
      if (posted.status === 'REJECTED') {
        // The money was (probably) spent but the ledger refused it. Keep the
        // reservation RESERVED so it still counts, and record why.
        await this.db.prepare('UPDATE spend_authorizations SET outcome = ? WHERE id = ?').bind(`LEDGER_REJECTED: ${posted.reason}`.slice(0, 300), id).run();
        return { ok: false, detail: posted.reason };
      }
      ledgerEntryId = posted.entry.id;
    }
    await this.db
      .prepare(`UPDATE spend_authorizations SET status = 'SETTLED', amount_actual = ?, ledger_entry_id = ?, settled_at = ?, outcome = 'OK' WHERE id = ? AND status = 'RESERVED'`)
      .bind(actual, ledgerEntryId, new Date(this.clock()).toISOString(), id)
      .run();
    return { ok: true };
  }

  async release(id: string, outcome: string) {
    await this.db
      .prepare(`UPDATE spend_authorizations SET status = 'RELEASED', outcome = ?, settled_at = ? WHERE id = ? AND status = 'RESERVED'`)
      .bind(outcome.slice(0, 300), new Date(this.clock()).toISOString(), id)
      .run();
  }
}
