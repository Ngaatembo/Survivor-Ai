/* ============================================================================
 * Survivor economy — emergency kill switch.
 * ----------------------------------------------------------------------------
 * Stored server-side (kv_store, key control:kill_switch). It is read
 * immediately before every dangerous operation: starting a cycle, every paid
 * AI call, every paid search, every ledger-moving route and every external
 * action. If the state cannot be read, callers treat it as ENGAGED — a
 * broken switch must stop work, not allow it.
 * ========================================================================== */

export const KILL_SWITCH_KEY = 'control:kill_switch';

export interface KillSwitchState {
  engaged: boolean;
  reason: string;
  changedAt: number;
  changedBy: string;
}

export interface KvAccess {
  getKV(key: string): Promise<string | null>;
  setKV(key: string, value: string): Promise<void>;
}

export async function readKillSwitch(kv: KvAccess): Promise<KillSwitchState> {
  let raw: string | null;
  try {
    raw = await kv.getKV(KILL_SWITCH_KEY);
  } catch (e) {
    return { engaged: true, reason: `kill switch state unreadable (${(e as Error).message}) — failing closed`, changedAt: Date.now(), changedBy: 'system' };
  }
  if (!raw) return { engaged: false, reason: '', changedAt: 0, changedBy: '' };
  try {
    const parsed = JSON.parse(raw);
    return {
      engaged: parsed?.engaged !== false,
      reason: typeof parsed?.reason === 'string' ? parsed.reason : '',
      changedAt: Number(parsed?.changedAt) || 0,
      changedBy: typeof parsed?.changedBy === 'string' ? parsed.changedBy : '',
    };
  } catch {
    return { engaged: true, reason: 'kill switch state is corrupt — failing closed', changedAt: Date.now(), changedBy: 'system' };
  }
}

export async function setKillSwitch(kv: KvAccess, engaged: boolean, reason: string, changedBy: string): Promise<KillSwitchState> {
  const state: KillSwitchState = { engaged, reason, changedAt: Date.now(), changedBy };
  await kv.setKV(KILL_SWITCH_KEY, JSON.stringify(state));
  return state;
}

/** null when work may proceed, otherwise the reason it must not. */
export async function killSwitchBlock(kv: KvAccess): Promise<string | null> {
  const state = await readKillSwitch(kv);
  return state.engaged ? `KILL_SWITCH_ENGAGED: ${state.reason || 'emergency stop'}` : null;
}
