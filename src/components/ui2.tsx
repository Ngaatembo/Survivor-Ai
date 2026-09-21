/* Frontend 2.0 — shared data-state badge. Presentation only; no data logic. */

export type DataState = 'LIVE' | 'SIMULATED' | 'SAMPLE' | 'UNAVAILABLE';

const META: Record<DataState, { icon: string; cls: string; hint: string }> = {
  LIVE: { icon: '●', cls: 'state-live', hint: 'Read from the deployed backend' },
  SIMULATED: { icon: '◉', cls: 'state-sim', hint: 'Practice money inside the simulation — not customer revenue' },
  SAMPLE: { icon: '◇', cls: 'state-sample', hint: 'Seeded demo data — not live research' },
  UNAVAILABLE: { icon: '⚠', cls: 'state-na', hint: 'The backend has not provided this data' },
};

export function DataStateBadge({ state }: { state: DataState }) {
  const m = META[state];
  return (
    <span className={`state-badge ${m.cls}`} title={m.hint}>
      <span aria-hidden="true">{m.icon}</span>
      {state.charAt(0) + state.slice(1).toLowerCase()}
    </span>
  );
}
