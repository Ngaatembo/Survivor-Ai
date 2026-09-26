import { useEffect, useState } from 'react';
import {
  approveSurvivalChallenge,
  cancelSurvivalChallenge,
  getSurvivalChallenge,
  markSurvivalChallengeStarted,
  recordSurvivalChallengeResult,
  startSurvivalChallenge,
  type SurvivalChallenge,
  type SurvivalChallengeResponse,
  type SurvivalChallengeResult,
} from '../services/backendApi';
import { backendConfigured } from '../store';

const RESULT_OPTIONS: SurvivalChallengeResult[] = ['SUCCESS', 'PARTIAL_SUCCESS', 'FAILED', 'INCONCLUSIVE'];

function phaseLabel(phase: SurvivalChallenge['phase']): string {
  return phase === 'AWAITING_APPROVAL'
    ? 'Awaiting your approval'
    : phase === 'READY_FOR_HUMAN_EXECUTION'
      ? 'Ready for you to execute'
      : phase === 'AWAITING_RESULT'
        ? 'Waiting for your result'
        : phase === 'COMPLETED'
          ? 'Completed'
          : phase === 'FAILED'
            ? 'Failed'
            : 'Cancelled';
}

export function SurvivalChallengePanel() {
  const [state, setState] = useState<SurvivalChallengeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [selectedResult, setSelectedResult] = useState<SurvivalChallengeResult>('SUCCESS');

  const refresh = async () => {
    if (!backendConfigured) return;
    try {
      setState(await getSurvivalChallenge());
      setError('');
    } catch (e) {
      setError((e as Error).message || 'Could not load the Survival Challenge.');
    }
  };

  useEffect(() => { void refresh(); }, []);

  if (!backendConfigured) return null;

  const challenge = state?.challenge ?? null;
  const terminal = !!challenge && ['COMPLETED', 'FAILED', 'CANCELLED'].includes(challenge.phase);

  const run = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await work();
      await refresh();
    } catch (e) {
      setError((e as Error).message || 'Survival Challenge action failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="money-card">
      <div className="card-head">
        <div>
          <h2>Survival Challenge</h2>
          <span className="faint small">
            Survivor proposes the action; you approve, execute it yourself, and report what actually happened.
          </span>
        </div>
        <span className="faint small">HUMAN CONTROLLED</span>
      </div>

      {error && <p className="muted small" role="alert">{error}</p>}

      {!challenge || terminal ? (
        <div>
          {challenge && (
            <div className="action-card" style={{ marginBottom: 12 }}>
              <div className="action-title">{challenge.action}</div>
              <div className="muted small">{phaseLabel(challenge.phase)}{challenge.result ? ` · ${challenge.result}` : ''}</div>
              {challenge.resultNote && <p className="muted small">{challenge.resultNote}</p>}
            </div>
          )}

          {state?.nextAction ? (
            <>
              <div className="action-title">{state.nextAction.title}</div>
              <p className="muted small">{state.nextAction.description}</p>
              {state.nextAction.prospectName && <div className="muted small">Target: {state.nextAction.prospectName}</div>}
              <button
                className="btn primary big"
                disabled={busy}
                onClick={() => run(() => startSurvivalChallenge(state.nextAction!.id))}
              >
                {busy ? 'Starting…' : challenge ? 'Start next challenge' : 'Start Survival Challenge'}
              </button>
            </>
          ) : (
            <p className="muted">No recommended human action is currently available. Survivor will surface one after the next cycle.</p>
          )}
        </div>
      ) : (
        <>
          <div className="money-main">
            <div>
              <div className="money-title">{challenge.action}</div>
              <div className="muted">{challenge.prospectName ?? challenge.opportunityName ?? challenge.actionKind}</div>
            </div>
            <div className="faint small">{phaseLabel(challenge.phase)}</div>
          </div>

          <p className="money-why">{challenge.objective}</p>

          <div className="prep">
            {challenge.guardrails.map((g) => <span className="ok" key={g}>✓ {g}</span>)}
          </div>

          <div className="act-row" style={{ marginTop: 12 }}>
            {challenge.phase === 'AWAITING_APPROVAL' && (
              <button className="btn primary big" disabled={busy} onClick={() => run(approveSurvivalChallenge)}>
                {busy ? 'Saving…' : 'Approve challenge'}
              </button>
            )}

            {challenge.phase === 'READY_FOR_HUMAN_EXECUTION' && (
              <button className="btn primary big" disabled={busy} onClick={() => run(markSurvivalChallengeStarted)}>
                {busy ? 'Saving…' : 'I started the action'}
              </button>
            )}

            {challenge.phase === 'AWAITING_RESULT' && (
              <>
                {RESULT_OPTIONS.map((result) => (
                  <button
                    key={result}
                    className={selectedResult === result ? 'btn primary big' : 'btn big'}
                    disabled={busy}
                    onClick={() => setSelectedResult(result)}
                  >
                    {result.replace('_', ' ')}
                  </button>
                ))}
                <button
                  className="btn primary big"
                  disabled={busy}
                  onClick={() => run(() => recordSurvivalChallengeResult(selectedResult, note.trim() || undefined))}
                >
                  {busy ? 'Saving…' : 'Record result'}
                </button>
              </>
            )}

            <button
              className="btn big"
              disabled={busy}
              onClick={() => run(() => cancelSurvivalChallenge('Cancelled by operator'))}
            >
              Cancel
            </button>
          </div>

          {challenge.phase === 'AWAITING_RESULT' && (
            <label className="muted small" style={{ display: 'block', marginTop: 10 }}>
              Result note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What actually happened? Include demand, response, cost, or outcome."
                rows={3}
                style={{ display: 'block', width: '100%', marginTop: 6 }}
              />
            </label>
          )}

          <p className="muted small" style={{ marginTop: 12 }}>
            A successful challenge does not create revenue by itself. If money was actually received, record it in the real-revenue ledger; independently verified payments are what feed Survivor's economic learning.
          </p>
        </>
      )}
    </section>
  );
}
