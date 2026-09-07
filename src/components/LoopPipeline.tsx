import { useStore } from '../store';
import type { CycleStepKey } from '../types';

const STEP_ICONS: Record<CycleStepKey, string> = {
  RESEARCH: '◎',
  DISCOVER: '◇',
  VERIFY: '◈',
  SCORE: '▴',
  RANK: '☰',
  SELECT: '➤',
  SIMULATE: '▶',
  MEASURE: '≡',
  LEARN: '✓',
};

export function LoopPipeline() {
  const activeCycleId = useStore((s) => s.loop.activeCycleId);
  const currentStep = useStore((s) => s.loop.currentStep);
  const running = useStore((s) => s.loop.running);
  const cycles = useStore((s) => s.cycles);
  const lastCycle = [...cycles].reverse().find((c) => c.id === activeCycleId || !activeCycleId);
  const cycle = activeCycleId ? cycles.find((c) => c.id === activeCycleId) ?? lastCycle : lastCycle;

  const steps =
    cycle?.steps ??
    (['RESEARCH', 'DISCOVER', 'VERIFY', 'SCORE', 'RANK', 'SELECT', 'SIMULATE', 'MEASURE', 'LEARN'] as CycleStepKey[]).map(
      (key) => ({ key, label: key[0] + key.slice(1).toLowerCase(), status: 'pending' as const }),
    );

  return (
    <div className="pipeline">
      {steps.map((s, i) => (
        <div
          key={s.key}
          className={`pipe-node ${s.status === 'done' ? 'done' : ''} ${
            s.status === 'active' ? 'active' : ''
          } ${s.status === 'skipped' ? 'skipped' : ''}`}
        >
          <span className="pipe-state">{s.status === 'active' ? '' : STEP_ICONS[s.key as CycleStepKey]}</span>
          {s.label}
          <div style={{ marginTop: 3, fontSize: 9, opacity: 0.7 }}>
            {s.status === 'done' ? 'done' : s.status === 'active' ? (running ? 'running' : 'working') : s.status === 'skipped' ? 'skipped' : i + 1}
          </div>
        </div>
      ))}
    </div>
  );
}
