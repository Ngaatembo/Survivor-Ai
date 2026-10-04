/* ============================================================================
 * Survivor economy — persistence port for runs and ledger entries.
 * D1LedgerStore (src/economy/d1LedgerStore.ts) is production; the in-memory
 * store backs tests and the local browser demo. Stores do not decide anything:
 * all rules live in ledger.ts and are applied by Treasury.
 * ========================================================================== */

import type { LedgerEntry, RunStatus, SurvivorRun } from './ledger';
import { OPEN_RUN_STATUSES, TERMINAL_RUN_STATUSES } from './ledger';

export type InsertResult = 'INSERTED' | 'DUPLICATE';

export interface LedgerStore {
  /** The open run (CREATED/ALIVE/DEPLETED), if any. At most one exists. */
  getOpenRun(): Promise<SurvivorRun | null>;
  /** The most recently created run of any status (used to report a dead run). */
  getLatestRun(): Promise<SurvivorRun | null>;
  getRun(runId: string): Promise<SurvivorRun | null>;
  listRuns(): Promise<SurvivorRun[]>;
  insertRun(run: SurvivorRun): Promise<void>;
  /** Change status only if the run is currently in one of `from`. Returns
   *  false when the guard did not match (e.g. a concurrent writer). */
  transitionRun(runId: string, from: readonly RunStatus[], patch: Partial<SurvivorRun> & { status: RunStatus }): Promise<boolean>;
  listEntries(runId: string): Promise<LedgerEntry[]>;
  findByIdempotencyKey(key: string): Promise<LedgerEntry | null>;
  /** Insert unless the idempotency key already exists. */
  insertEntry(entry: LedgerEntry): Promise<InsertResult>;
}

export class InMemoryLedgerStore implements LedgerStore {
  runs: SurvivorRun[] = [];
  entries: LedgerEntry[] = [];

  async getOpenRun() {
    return this.runs.find((r) => OPEN_RUN_STATUSES.includes(r.status)) ?? null;
  }
  async getLatestRun() {
    return [...this.runs].sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }
  async getRun(runId: string) {
    return this.runs.find((r) => r.id === runId) ?? null;
  }
  async listRuns() {
    return [...this.runs].sort((a, b) => b.createdAt - a.createdAt);
  }
  async insertRun(run: SurvivorRun) {
    if (OPEN_RUN_STATUSES.includes(run.status) && (await this.getOpenRun())) {
      throw new Error('another run is still open; end it before creating a new one');
    }
    this.runs.push({ ...run });
  }
  async transitionRun(runId: string, from: readonly RunStatus[], patch: Partial<SurvivorRun> & { status: RunStatus }) {
    const run = this.runs.find((r) => r.id === runId);
    if (!run || !from.includes(run.status)) return false;
    if (TERMINAL_RUN_STATUSES.includes(run.status) && patch.status !== run.status) return false;
    Object.assign(run, patch);
    return true;
  }
  async listEntries(runId: string) {
    return this.entries.filter((e) => e.runId === runId).sort((a, b) => a.createdAt - b.createdAt);
  }
  async findByIdempotencyKey(key: string) {
    return this.entries.find((e) => e.idempotencyKey === key) ?? null;
  }
  async insertEntry(entry: LedgerEntry): Promise<InsertResult> {
    if (this.entries.some((e) => e.idempotencyKey === entry.idempotencyKey)) return 'DUPLICATE';
    const run = this.runs.find((r) => r.id === entry.runId);
    // Mirrors the migration 0022 trigger: closed runs accept nothing.
    if (!run || !OPEN_RUN_STATUSES.includes(run.status)) throw new Error('ledger: run is not open');
    this.entries.push({ ...entry });
    return 'INSERTED';
  }
}
