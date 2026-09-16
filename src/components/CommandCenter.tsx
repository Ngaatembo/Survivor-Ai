import { useStore, useWalletTotals, backendConfigured } from '../store';
import { Panel, Stat, Badge, DataSourceBadge } from './ui';
import { SurvivalMeter } from './SurvivalMeter';
import { LoopPipeline } from './LoopPipeline';
import { usd, usdWhole, pct, timeAgo } from '../lib/format';
import type { View } from '../App';

const LIFECYCLE_ORDER = ['DISCOVERED', 'VALIDATING', 'PROVEN', 'SCALING', 'FAILED'] as const;
const LIFECYCLE_TONE: Record<string, 'gray' | 'blue' | 'green' | 'purple' | 'red'> = {
  DISCOVERED: 'gray',
  VALIDATING: 'blue',
  PROVEN: 'green',
  SCALING: 'purple',
  FAILED: 'red',
  ARCHIVED: 'red',
};

export function CommandCenter({ go }: { go: (v: View) => void }) {
  const agent = useStore((s) => s.agent);
  const { balance, revenue, expenses, profit } = useWalletTotals();
  const opportunities = useStore((s) => s.opportunities);
  const experiments = useStore((s) => s.experiments);
  const events = useStore((s) => s.events);
  const memory = useStore((s) => s.memory);
  const reports = useStore((s) => s.reports);
  const actions = useStore((s) => s.actions);
  const prospects = useStore((s) => s.prospects);
  const dead = agent.status === 'DEAD';

  const highPriorityProspects = prospects.filter((p) => p.priority === 'HIGH').length;
  const dueFollowUps = prospects.filter((p) => p.nextFollowUpAt && p.nextFollowUpAt <= Date.now()).length;
  const pipelineCounts = ['QUALIFIED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON'].map(
    (status) => ({ status, count: prospects.filter((p) => p.status === status).length }),
  );

  const portfolio = LIFECYCLE_ORDER.map((state) => ({
    state,
    count: opportunities.filter((o) => (o.lifecycleState ?? 'DISCOVERED') === state).length,
  }));

  const discovered = opportunities.filter((o) => o.researchStage !== 'UNDISCOVERED');
  const successful = experiments.filter((e) => e.outcome === 'SUCCESS' || e.outcome === 'PARTIAL_SUCCESS').length;
  const failed = experiments.filter((e) => e.outcome === 'FAILED').length;
  const roi = agent.startingCapital > 0 ? (profit / agent.startingCapital) * 100 : 0;

  const ranked = discovered
    .filter((o) => o.score && !o.executionBlocked)
    .sort((a, b) => b.score!.total - a.score!.total)
    .slice(0, 5);

  return (
    <div className="view-enter">
      {dead && (
        <div className="dead-banner">
          AGENT DEAD — simulated capital reached $0.00. The agent is in read-only mode; historical
          data remains available. Reset the simulation to start again.
        </div>
      )}

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Panel tight>
          <Stat label="Current balance" value={usd(balance)} tone={profit >= 0 ? 'neu' : 'neu'} sub={`started with ${usd(agent.startingCapital)}`} />
        </Panel>
        <Panel tight>
          <Stat label="Revenue" value={usdWhole(revenue)} tone="pos" sub="simulated, all experiments" />
        </Panel>
        <Panel tight>
          <Stat label="Expenses" value={usdWhole(expenses)} tone="neg" sub="simulated experiment spend" />
        </Panel>
        <Panel tight>
          <Stat
            label="Profit / loss"
            value={<span className={profit >= 0 ? 'pos' : 'neg'}>{usd(profit)}</span>}
            sub={`ROI ${pct(roi)} on capital`}
          />
        </Panel>
      </div>

      <div className="grid cols-4" style={{ marginBottom: 14 }}>
        <Panel tight>
          <Stat label="Opportunities discovered" value={discovered.length} sub={`of ${opportunities.length} in knowledge base`} />
        </Panel>
        <Panel tight>
          <Stat label="Experiments run" value={experiments.length} sub={`${successful} positive · ${failed} failed`} />
        </Panel>
        <Panel tight>
          <Stat label="Survival threshold" value={usd(agent.survivalThreshold)} sub={balance < agent.survivalThreshold ? '⚠ balance below threshold' : 'balance above threshold'} />
        </Panel>
        <Panel tight>
          <Stat label="Research cycles" value={agent.totalCyclesRun} sub={`${reports.length} reports · ${memory.length} memory records`} />
        </Panel>
      </div>

      <div className="grid cols-3" style={{ gridTemplateColumns: '1.6fr 1fr', marginBottom: 14 }}>
        <Panel
          title="Autonomous loop"
          right={
            <span className="faint small mono">
              RESEARCH → DISCOVER → VERIFY → SCORE → RANK → SELECT → SIMULATE → MEASURE → LEARN
            </span>
          }
        >
          <LoopPipeline />
          <div style={{ marginTop: 14 }}>
            <div className="mono-label" style={{ marginBottom: 5 }}>Current strategy</div>
            <div style={{ fontSize: 13, fontWeight: 600 }}>{agent.currentStrategy}</div>
            <div className="muted small" style={{ marginTop: 4, lineHeight: 1.6 }}>{agent.currentObjective}</div>
          </div>
        </Panel>

        <Panel title="Survival">
          <SurvivalMeter />
        </Panel>
      </div>

      <div className="grid cols-2" style={{ gridTemplateColumns: '1.3fr 1fr', marginBottom: 14 }}>
        <Panel
          title="What should I do now?"
          right={
            <span className="faint small mono">
              {agent.status === 'ALIVE'
                ? 'ranked by expected value'
                : agent.status === 'AT_RISK'
                  ? 'ranked by expected value, favoring lower-effort actions'
                  : 'ranked by expected value, strongly favoring fast/cheap actions (low funds)'}
            </span>
          }
        >
          {actions.length === 0 ? (
            <div className="empty">
              No recommended actions yet — these appear once opportunities have been scored and evaluated
              (business-model output, opportunity lifecycle §4, KILL/ITERATE/SCALE §5). Simulated only until
              you act on one for real.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {actions.slice(0, 5).map((a) => (
                <div key={a.id} className="event" style={{ display: 'block' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontWeight: 600 }}>
                    <span>
                      #{a.rank} {a.title}
                    </span>
                    <span className="faint small mono">value ~${a.expectedValue.toFixed(0)}</span>
                  </div>
                  <div className="muted small" style={{ marginTop: 3, lineHeight: 1.5 }}>
                    {a.description}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Opportunity portfolio" right={<span className="faint small mono">lifecycle</span>}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {portfolio.map((p) => (
              <div key={p.state} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Badge tone={LIFECYCLE_TONE[p.state]}>{p.state}</Badge>
                <span style={{ fontWeight: 700 }}>{p.count}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>

      <div className="grid" style={{ marginBottom: 14 }}>
        <Panel
          title="Sales pipeline"
          right={
            <button className="btn small" onClick={() => go('prospects')}>
              Open CRM →
            </button>
          }
        >
          {prospects.length === 0 ? (
            <div className="empty">
              No prospects yet — discovered automatically once a Local / Real-World opportunity has a
              business model and evidence of real demand (needs a connected live search provider).
            </div>
          ) : (
            <>
              <div className="faint small mono" style={{ marginBottom: 10 }}>
                {prospects.length} discovered · {highPriorityProspects} high priority · {dueFollowUps} follow-up(s) due
              </div>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                {pipelineCounts.map((p) => (
                  <div key={p.status} style={{ textAlign: 'center', minWidth: 64 }}>
                    <div style={{ fontSize: 20, fontWeight: 700 }}>{p.count}</div>
                    <div className="faint small mono">{p.status.replace('_', ' ')}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </div>

      <div className="grid cols-2" style={{ gridTemplateColumns: '1.4fr 1fr' }}>
        <Panel
          title="Top ranked opportunities"
          right={
            <button className="btn small" onClick={() => go('explorer')}>
              Open explorer →
            </button>
          }
        >
          {ranked.length === 0 ? (
            <div className="empty">No scored opportunities yet — run a research cycle.</div>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Score</th>
                  <th>Opportunity</th>
                  <th>Capital</th>
                  <th>Revenue in</th>
                  <th>Evidence</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((o) => (
                  <tr key={o.id} className="clickable" onClick={() => go('explorer')}>
                    <td className="num" style={{ fontWeight: 700 }}>{o.score!.total}</td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{o.name}</div>
                      <div className="faint small mono">{o.category}</div>
                    </td>
                    <td className="num small">
                      {o.capitalRequiredMax === 0 ? '$0' : `$${o.capitalRequiredMin}–$${o.capitalRequiredMax}`}
                    </td>
                    <td className="num small">
                      {o.timeToRevenueDaysMin}–{o.timeToRevenueDaysMax}d
                    </td>
                    <td>
                      <Badge
                        tone={
                          o.evidenceTier === 'VERIFIED'
                            ? 'green'
                            : o.evidenceTier === 'LIKELY'
                              ? 'blue'
                              : o.evidenceTier === 'UNCERTAIN'
                                ? 'amber'
                                : 'red'
                        }
                      >
                        {o.evidenceTier}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Panel>

        <Panel title="Recent activity" right={<DataSourceBadge source={backendConfigured ? 'LIVE' : 'SAMPLE'} />}>
          <div className="feed" style={{ maxHeight: 280, overflowY: 'auto' }}>
            {[...events].reverse().slice(0, 9).map((e) => (
              <div key={e.id} className="event">
                <span className="ev-time">{timeAgo(e.createdAt)}</span>
                <span className="ev-msg">{e.message}</span>
              </div>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
