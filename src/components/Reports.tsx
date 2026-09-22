import { useState } from 'react';
import { useStore, backendConfigured } from '../store';
import { Panel, Badge, DataSourceBadge, RecommendationBadge } from './ui';
import { dateTime } from '../lib/format';
import type { ResearchReport } from '../types';

function ReportDoc({ report, onClose }: { report: ResearchReport; onClose: () => void }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="report-doc">
          <div className="drawer-head">
            <div>
              <div style={{ display: 'flex', gap: 7, marginBottom: 8 }}>
                <DataSourceBadge source={report.dataSource} />
                <Badge tone={report.generator === 'local-rule-engine' ? 'gray' : 'green'}>
                  {report.generator === 'local-rule-engine' ? 'RULE ENGINE — LLM NOT CONNECTED' : 'LLM'}
                </Badge>
              </div>
              <h1>Research Report</h1>
              <div className="faint small mono">
                {report.opportunityName} · generated {dateTime(report.generatedAt)}
              </div>
            </div>
            <button className="close" onClick={onClose}>✕</button>
          </div>

          <h4>Executive summary</h4>
          <p>{report.executiveSummary}</p>

          <h4>Market opportunity</h4>
          <p>{report.marketOpportunity}</p>

          <h4>How the model works</h4>
          <p>{report.howItWorks}</p>

          <h4>Capital requirements</h4>
          <p>{report.capitalRequirements}</p>

          <h4>Competition</h4>
          <p>{report.competition}</p>

          <h4>Risks</h4>
          <ul>{report.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>

          <h4>Evidence</h4>
          <p>{report.evidence}</p>

          <h4>Potential revenue</h4>
          <p>{report.potentialRevenue}</p>

          <h4>Recommended experiment</h4>
          <p>{report.recommendedExperiment}</p>

          <h4>Assessment</h4>
          <p>
            Confidence: <strong className="num">{Math.round(report.confidence * 100)}%</strong> · Final
            score: <strong className="num">{report.finalScore}/100</strong>
          </p>

          <div className="faint small mono" style={{ marginTop: 24, lineHeight: 1.7 }}>
            Prepared by SURVIVE AI v0.1 · {report.dataSource === 'SAMPLE' ? 'Based on SAMPLE seed data — verify with live research before any real decision.' : 'Based on live research.'}
            <br />Not financial advice. All figures are model outputs in a simulated environment.
          </div>
        </div>
      </div>
    </>
  );
}

export function Reports() {
  const reports = useStore((s) => s.reports);
  const opportunities = useStore((s) => s.opportunities);
  const generateReportFor = useStore((s) => s.generateReportFor);
  const [openId, setOpenId] = useState<string | null>(null);

  const open = reports.find((r) => r.id === openId) ?? null;

  return (
    <div className="view-enter">
      <div className="info-banner">
        Structured reports are generated from researched opportunities. v1 uses the local rule engine
        (the LLM connector is <strong>not connected</strong>); the report schema is identical to what
        an LLM provider will fill later and is export-ready.
      </div>

      <Panel title="Research reports" style={{ marginBottom: 14 }}>
        {reports.length === 0 ? (
          <div className="empty">
            No reports yet. Open an opportunity in the Explorer and choose “Generate research report”.
          </div>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Generated</th>
                <th>Opportunity</th>
                <th>Score</th>
                <th>Confidence</th>
                <th>Generator</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="clickable" onClick={() => setOpenId(r.id)}>
                  <td className="faint small mono whitespace-nowrap">{dateTime(r.generatedAt)}</td>
                  <td style={{ fontWeight: 600 }}>{r.opportunityName}</td>
                  <td className="num">{r.finalScore}</td>
                  <td className="num">{Math.round(r.confidence * 100)}%</td>
                  <td><Badge tone="gray">{r.generator === 'local-rule-engine' ? 'rule engine' : 'LLM'}</Badge></td>
                  <td><button className="btn small" onClick={(e) => { e.stopPropagation(); setOpenId(r.id); }}>Open</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="Generate from researched opportunities"
        right={<span className="faint small mono">{opportunities.filter((o) => o.score).length} scored</span>}
      >
        <div className="opp-grid">
          {opportunities
            .filter((o) => o.score)
            .sort((a, b) => b.score!.total - a.score!.total)
            .slice(0, 9)
            .map((o) => (
              <div key={o.id} className="opp-card" style={{ cursor: 'default' }}>
                <div className="opp-head">
                  <div className="opp-name" style={{ fontSize: 12.5 }}>{o.name}</div>
                  <span className="num" style={{ fontWeight: 700 }}>{o.score!.total}</span>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <RecommendationBadge rec={o.score!.recommendation} />
                </div>
                <div className="opp-foot">
                  {!backendConfigured && (
                    <button className="btn small" onClick={() => generateReportFor(o.id)}>
                      {reports.some((r) => r.opportunityId === o.id) ? 'Regenerate report' : 'Generate report'}
                    </button>
                  )}
                  {reports.some((r) => r.opportunityId === o.id) && (
                    <button className="btn small" onClick={() => setOpenId(reports.find((r) => r.opportunityId === o.id)!.id)}>
                      View →
                    </button>
                  )}
                </div>
              </div>
            ))}
        </div>
      </Panel>

      {open && <ReportDoc report={open} onClose={() => setOpenId(null)} />}
    </div>
  );
}
