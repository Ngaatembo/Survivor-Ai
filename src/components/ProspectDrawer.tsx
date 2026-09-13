import { useStore } from '../store';
import { Badge, DataSourceBadge, KV } from './ui';
import { dateTime } from '../lib/format';
import type { Prospect } from '../types';

const PRIORITY_TONE: Record<Prospect['priority'], 'green' | 'blue' | 'amber' | 'gray'> = {
  HIGH: 'green',
  MEDIUM: 'blue',
  LOW: 'amber',
  DO_NOT_CONTACT: 'gray',
};

const PRESENCE_LABEL: Record<Prospect['websitePresence'], string> = {
  NONE_FOUND: 'No website found',
  SOCIAL_ONLY: 'Social page only (no independent website)',
  WEAK_OR_OUTDATED: 'Weak or outdated website',
  ADEQUATE: 'Already has a website',
  UNKNOWN: 'Website status not yet determined',
};

export function ProspectDrawer({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const outreach = useStore((s) => s.outreachMessages.find((m) => m.prospectId === prospect.id));
  const interactions = useStore((s) =>
    s.prospectInteractions.filter((i) => i.prospectId === prospect.id).slice(0, 10),
  );

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-head">
          <div>
            <div style={{ display: 'flex', gap: 7, marginBottom: 8, flexWrap: 'wrap' }}>
              <DataSourceBadge source={prospect.dataSource} />
              <Badge tone={PRIORITY_TONE[prospect.priority]}>{prospect.priority}</Badge>
              <span className="stage-badge lit">{prospect.status.replace('_', ' ')}</span>
            </div>
            <h2>{prospect.businessName}</h2>
            <div className="faint small mono" style={{ marginTop: 4 }}>
              {prospect.category} · {prospect.location}
            </div>
          </div>
          <button className="close" onClick={onClose}>
            ✕
          </button>
        </div>

        {prospect.priority === 'DO_NOT_CONTACT' && (
          <div className="warn-banner" style={{ marginTop: 14 }}>
            <strong>Not recommended for outreach.</strong> {prospect.evidenceNotes}
          </div>
        )}

        <div className="drawer-section">
          <h3>Why this prospect</h3>
          <p>{prospect.evidenceNotes}</p>
          <p style={{ marginTop: 8 }}>
            <span className="mono-label">Website presence — </span>
            {PRESENCE_LABEL[prospect.websitePresence]}
          </p>
          <ul style={{ marginTop: 8, paddingLeft: 18 }}>
            {prospect.score.factors.map((f, i) => (
              <li key={i} className="small muted" style={{ marginBottom: 3 }}>
                {f}
              </li>
            ))}
          </ul>
        </div>

        <div className="drawer-section">
          <h3>Lead economics — score {prospect.score.total}/100</h3>
          <div className="kv">
            <KV k="Expected deal value" v={`$${prospect.score.expectedDealValue.toFixed(2)}`} />
            <KV k="Expected acquisition cost" v={`$${prospect.score.expectedAcquisitionCost.toFixed(2)}`} />
            <KV k="Expected profit" v={`$${prospect.score.expectedProfit.toFixed(2)}`} />
            <KV k="Probability of close" v={`${Math.round(prospect.score.probabilityOfClose * 100)}%`} />
            <KV k="Expected value" v={`$${prospect.score.expectedValue.toFixed(2)}`} />
            <KV k="Est. time to revenue" v={`~${prospect.score.expectedTimeToRevenueDays} days`} />
          </div>
        </div>

        <div className="drawer-section">
          <h3>Contact</h3>
          <div className="kv">
            <KV k="Channel" v={prospect.contactChannel.replace('_', ' ')} />
            <KV k="Value" v={prospect.contactValue ?? 'not found'} />
          </div>
        </div>

        {outreach ? (
          <div className="drawer-section">
            <h3>Outreach messages (draft — review before sending)</h3>
            <div className="warn-banner" style={{ marginBottom: 12 }}>
              These are AI-drafted messages for a human to review and send manually. SURVIVE AI never
              contacts anyone automatically.
            </div>
            <p className="small" style={{ marginBottom: 8 }}>
              <span className="mono-label">WhatsApp — </span>
              {outreach.whatsapp}
            </p>
            <p className="small" style={{ marginBottom: 8 }}>
              <span className="mono-label">SMS — </span>
              {outreach.sms}
            </p>
            <p className="small" style={{ marginBottom: 8 }}>
              <span className="mono-label">Email subject — </span>
              {outreach.email.subject}
            </p>
            <p className="small" style={{ marginBottom: 8, whiteSpace: 'pre-wrap' }}>
              <span className="mono-label">Email body — </span>
              {outreach.email.body}
            </p>
            <p className="small" style={{ marginBottom: 8 }}>
              <span className="mono-label">Follow-up 1 — </span>
              {outreach.followUp1}
            </p>
            <p className="small" style={{ marginBottom: 8 }}>
              <span className="mono-label">Follow-up 2 — </span>
              {outreach.followUp2}
            </p>
            <h3 style={{ marginTop: 14 }}>Objection handling</h3>
            {outreach.objectionResponses.map((o, i) => (
              <p key={i} className="small" style={{ marginBottom: 6 }}>
                <em>{o.objection}</em> — {o.response}
              </p>
            ))}
            <h3 style={{ marginTop: 14 }}>Call script</h3>
            <ol style={{ paddingLeft: 18 }}>
              {outreach.callScript.map((s, i) => (
                <li key={i} className="small" style={{ marginBottom: 4 }}>
                  {s}
                </li>
              ))}
            </ol>
          </div>
        ) : (
          <div className="drawer-section">
            <div className="empty">
              No outreach messages generated yet — these are prepared automatically for qualified
              prospects on the next research cycle.
            </div>
          </div>
        )}

        <div className="drawer-section">
          <h3>Sources</h3>
          {prospect.sources.map((s) => (
            <div className="source-item" key={s.id}>
              <span className="src-kind">{s.kind}</span>
              <div>
                <div>{s.title}</div>
                {s.note && <div className="faint small">{s.note}</div>}
                {s.url && <div className="small mono" style={{ color: 'var(--blue)' }}>{s.url}</div>}
              </div>
            </div>
          ))}
        </div>

        {interactions.length > 0 && (
          <div className="drawer-section">
            <h3>History</h3>
            <div className="feed">
              {interactions.map((i) => (
                <div key={i.id} className="event">
                  <span className="ev-time">{dateTime(i.createdAt)}</span>
                  <span className="ev-msg">{i.summary}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="faint small mono" style={{ marginTop: 10 }}>
          Business/contact details shown here come only from cited public sources — nothing is
          invented. Discovered date {dateTime(prospect.dateDiscovered)}.
        </div>
      </div>
    </>
  );
}
