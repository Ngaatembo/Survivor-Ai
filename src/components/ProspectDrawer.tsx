import { useState } from 'react';
import { useStore } from '../store';
import { Badge, DataSourceBadge, KV } from './ui';
import { dateTime } from '../lib/format';
import type { Prospect, ProspectStatus } from '../types';

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

/** Quick-action next statuses shown as buttons — the full state machine
 *  still allows any status via the CRM write path; these are just the
 *  common forward moves from wherever the prospect currently sits. */
const NEXT_STATUS_OPTIONS: Partial<Record<ProspectStatus, ProspectStatus[]>> = {
  DISCOVERED: ['CONTACTED', 'NOT_INTERESTED'],
  QUALIFIED: ['CONTACTED', 'NOT_INTERESTED'],
  CONTACTED: ['REPLIED', 'FOLLOW_UP', 'NOT_INTERESTED'],
  REPLIED: ['INTERESTED', 'NOT_INTERESTED'],
  INTERESTED: ['PROPOSAL_SENT', 'NOT_INTERESTED'],
  PROPOSAL_SENT: ['NEGOTIATING', 'WON', 'LOST'],
  NEGOTIATING: ['WON', 'LOST'],
  FOLLOW_UP: ['REPLIED', 'NOT_INTERESTED'],
};

export function ProspectDrawer({ prospect, onClose }: { prospect: Prospect; onClose: () => void }) {
  const outreach = useStore((s) => s.outreachMessages.find((m) => m.prospectId === prospect.id));
  const offer = useStore((s) => s.offers.find((o) => o.prospectId === prospect.id));
  const brief = useStore((s) => (offer ? s.designBriefs.find((b) => b.offerId === offer.id) : undefined));
  const project = useStore((s) => s.projects.find((p) => p.prospectId === prospect.id));
  const interactions = useStore((s) =>
    s.prospectInteractions.filter((i) => i.prospectId === prospect.id).slice(0, 10),
  );
  const updateProspectStatus = useStore((s) => s.updateProspectStatus);
  const updateOfferStatus = useStore((s) => s.updateOfferStatus);
  const intelligence = useStore((s) => s.prospectIntelligence.find((i) => i.prospectId === prospect.id));
  const marketPrice = useStore((s) => s.marketPriceResearch.find((m) => m.opportunityId === prospect.opportunityId));
  const researchProspectNow = useStore((s) => s.researchProspectNow);
  const unifiedProspectResearchNow = useStore((s) => s.unifiedProspectResearchNow);
  const verifyProspectNow = useStore((s) => s.verifyProspectNow);
  const demo = useStore((s) => s.prospectDemos.find((d) => d.prospectId === prospect.id));
  const regenerateProspectDemo = useStore((s) => s.regenerateProspectDemo);
  const viewProspectDemo = useStore((s) => s.viewProspectDemo);
  const [buildingDemo, setBuildingDemo] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [researching, setResearching] = useState(false);
  const [fullResearching, setFullResearching] = useState(false);
  const [verifying, setVerifying] = useState(false);

  const setStatus = async (status: ProspectStatus) => {
    setUpdating(true);
    try {
      await updateProspectStatus(prospect.id, status);
    } finally {
      setUpdating(false);
    }
  };

  const runVerification = async () => {
    setVerifying(true);
    try {
      await verifyProspectNow(prospect.id);
    } finally {
      setVerifying(false);
    }
  };

  const runResearch = async () => {
    setResearching(true);
    try {
      await researchProspectNow(prospect.id);
    } finally {
      setResearching(false);
    }
  };

  const runFullResearch = async () => {
    setFullResearching(true);
    try {
      await unifiedProspectResearchNow(prospect.id);
    } finally {
      setFullResearching(false);
    }
  };

  const runBuildDemo = async () => {
    setBuildingDemo(true);
    try {
      await regenerateProspectDemo(prospect.id);
    } finally {
      setBuildingDemo(false);
    }
  };

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
          <h3>Record outcome</h3>
          <p className="faint small" style={{ marginBottom: 8 }}>
            This is the only way a prospect advances — SURVIVE AI never contacts anyone or observes real
            replies itself.
          </p>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {(NEXT_STATUS_OPTIONS[prospect.status] ?? []).map((s) => (
              <button key={s} className="btn small" disabled={updating} onClick={() => setStatus(s)}>
                Mark {s.replace('_', ' ').toLowerCase()}
              </button>
            ))}
            {(NEXT_STATUS_OPTIONS[prospect.status] ?? []).length === 0 && (
              <span className="faint small">No further status changes suggested from here.</span>
            )}
          </div>
        </div>

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
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <div>
              <h3 style={{ margin: 0 }}>IDENTITY & CONTACT VERIFICATION</h3>
              <div className="faint small" style={{ marginTop: 3 }}>Combines independent public sources before Survivor treats a contact or location as reliable.</div>
            </div>
            <button className="btn small primary" disabled={verifying} onClick={runVerification}>
              {verifying ? 'Verifying…' : prospect.verification ? 'Verify again' : 'Verify now'}
            </button>
          </div>
          {prospect.verification ? (
            <>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <Badge tone={prospect.verification.status === 'VERIFIED' ? 'green' : prospect.verification.status === 'CONFLICT' ? 'amber' : 'blue'}>
                  {prospect.verification.status}
                </Badge>
                <span className="faint small mono">{prospect.verification.confidence}% confidence</span>
                <span className="faint small">{prospect.verification.independentSources} independent source(s)</span>
                <span className="faint small">{prospect.verification.contactSources} contact source(s)</span>
              </div>
              <div className="kv">
                <KV k="Verified business name" v={prospect.verification.verifiedBusinessName ?? prospect.businessName} />
                <KV k="Verified contact" v={prospect.verification.verifiedContactValue ?? 'Not verified'} />
                <KV k="Verified email" v={prospect.verification.verifiedEmail ?? 'Not verified'} />
                <KV k="Verified website" v={prospect.verification.verifiedWebsiteUrl ?? prospect.websiteUrl ?? 'Not verified'} />
                <KV k="Verified location" v={prospect.verification.verifiedLocation ?? prospect.location ?? 'Not verified'} />
              </div>
              {prospect.verification.conflictingContacts.length > 0 && (
                <div className="warn-banner" style={{ marginTop: 10 }}>
                  <strong>Contact conflict:</strong> {prospect.verification.conflictingContacts.join(' · ')}. Survivor will not choose an ambiguous number automatically.
                </div>
              )}
              {prospect.verification.notes.length > 0 && (
                <ul style={{ marginTop: 8, paddingLeft: 18 }}>
                  {prospect.verification.notes.map((note, i) => <li key={i} className="small muted" style={{ marginBottom: 3 }}>{note}</li>)}
                </ul>
              )}
              {prospect.verification.sourceUrls.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small faint" style={{ cursor: 'pointer' }}>Verification sources</summary>
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {prospect.verification.sourceUrls.map((url) => (
                      <li key={url} className="small muted" style={{ marginBottom: 3 }}>
                        <a href={url} target="_blank" rel="noreferrer">{url}</a>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="empty">Not verified yet. Run verification to search independent public sources and consolidate the business identity, contact, website and location.</div>
          )}
        </div>

        <div className="drawer-section">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <h3 style={{ margin: 0 }}>Deep research</h3>
            <div style={{ display: 'flex', gap: 6 }}>
              <button className="btn small" disabled={researching || fullResearching} onClick={runResearch}>
                {researching ? 'Researching…' : intelligence ? 'Research again' : 'Research now'}
              </button>
              <button className="btn small" disabled={researching || fullResearching} onClick={runFullResearch}>
                {fullResearching ? 'Full research…' : 'Full research'}
              </button>
            </div>

          </div>
          {intelligence ? (
            <>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                <Badge tone={intelligence.confidence === 'HIGH' ? 'green' : intelligence.confidence === 'MEDIUM' ? 'blue' : 'amber'}>
                  {intelligence.confidence} CONFIDENCE
                </Badge>
                <span className="faint small">
                  {intelligence.generator === 'llm' ? 'AI-synthesized' : 'Raw source digest (no LLM connected)'} ·{' '}
                  {intelligence.sources.length} source(s)
                </span>
              </div>
              <p className="small" style={{ marginBottom: 8 }}>
                <span className="mono-label">Overview — </span>
                {intelligence.businessOverview}
              </p>
              {intelligence.apparentServices.length > 0 && (
                <p className="small" style={{ marginBottom: 8 }}>
                  <span className="mono-label">Apparent services — </span>
                  {intelligence.apparentServices.join(', ')}
                </p>
              )}
              <p className="small" style={{ marginBottom: 8 }}>
                <span className="mono-label">Social presence — </span>
                {intelligence.socialPresenceSummary}
              </p>
              <p className="small" style={{ marginBottom: 8 }}>
                <span className="mono-label">Competitive note — </span>
                {intelligence.competitiveNote}
              </p>
              <p className="small" style={{ marginBottom: 8 }}>
                <span className="mono-label">Specific problem evidence — </span>
                {intelligence.specificProblemEvidence}
              </p>
              <p className="small" style={{ marginBottom: 8 }}>
                <span className="mono-label">Recommended angle — </span>
                {intelligence.recommendedAngle}
              </p>
              {intelligence.sources.length > 0 && (
                <details style={{ marginTop: 8 }}>
                  <summary className="small faint" style={{ cursor: 'pointer' }}>View sources</summary>
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {intelligence.sources.map((s) => (
                      <li key={s.id} className="small muted" style={{ marginBottom: 3 }}>
                        {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          ) : (
            <div className="empty">
              No deep research yet. This runs automatically on your top 3 prospects each cycle, or click
              "Research now" to run it on this one immediately.
            </div>
          )}
        </div>

        <div className="drawer-section">
          <h3>Full research result</h3>
          <p className="faint small" style={{ marginBottom: 10 }}>
            Survivor combines the verified business identity/contact evidence, business-specific research,
            and real market-price research before this package is treated as decision support.
          </p>
          <div className="kv">
            <KV k="Business name" v={prospect.verification?.verifiedBusinessName ?? prospect.businessName} />
            <KV k="Location" v={prospect.verification?.verifiedLocation ?? prospect.location} />
            <KV k="Contact" v={prospect.verification?.verifiedContactValue ?? prospect.contactValue ?? 'Not verified'} />
            <KV k="Website" v={prospect.verification?.verifiedWebsiteUrl ?? prospect.websiteUrl ?? 'Not verified'} />
            {marketPrice && (
              <KV
                k="Market price"
                v={
                  marketPrice.priceMax > 0
                    ? `${marketPrice.currency} ${marketPrice.priceMin}–${marketPrice.priceMax}`
                    : 'Insufficient pricing evidence'
                }
              />
            )}
          </div>
          {marketPrice && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
                <Badge tone={marketPrice.confidence === 'HIGH' ? 'green' : marketPrice.confidence === 'MEDIUM' ? 'blue' : 'amber'}>
                  {marketPrice.confidence} PRICING CONFIDENCE
                </Badge>
                <span className="faint small">
                  {marketPrice.generator === 'llm' ? 'Synthesized from observed prices' : 'Source digest only'} · {marketPrice.sources.length} source(s)
                </span>
              </div>
              <p className="small muted" style={{ marginBottom: 8 }}>
                <span className="mono-label">Pricing basis — </span>{marketPrice.rationale}
              </p>
              {marketPrice.sources.length > 0 && (
                <details>
                  <summary className="small faint" style={{ cursor: 'pointer' }}>Pricing sources</summary>
                  <ul style={{ marginTop: 6, paddingLeft: 18 }}>
                    {marketPrice.sources.map((s) => (
                      <li key={s.id} className="small muted" style={{ marginBottom: 3 }}>
                        {s.url ? <a href={s.url} target="_blank" rel="noreferrer">{s.title}</a> : s.title}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {prospect.verification?.status === 'CONFLICT' && (
            <div className="warn-banner" style={{ marginTop: 10 }}>
              <strong>Do not use the contact automatically.</strong> Independent sources disagree; review the conflicting contacts above before reaching out.
            </div>
          )}
          {prospect.verification?.status !== 'CONFLICT' && prospect.verification?.verifiedContactValue && (
            <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', marginTop: 10 }}>
              {['PHONE', 'WHATSAPP'].includes(prospect.verification.verifiedContactChannel ?? '') && (
                <a className="btn small" href={prospect.verification.verifiedContactChannel === 'WHATSAPP'
                  ? `https://wa.me/${prospect.verification.verifiedContactValue.replace(/\\D/g, '')}`
                  : `tel:${prospect.verification.verifiedContactValue}`}>
                  {prospect.verification.verifiedContactChannel === 'WHATSAPP' ? 'Open WhatsApp' : 'Call'}
                </a>
              )}
              {prospect.verification.verifiedEmail && (
                <a className="btn small" href={`mailto:${prospect.verification.verifiedEmail}`}>Email</a>
              )}
            </div>
          )}
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

        {offer ? (
          <div className="drawer-section">
            <h3>Offer — ${offer.price} · {offer.timelineDaysMin}-{offer.timelineDaysMax} days</h3>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10 }}>
              <span className="stage-badge lit small">{offer.status}</span>
              {offer.status === 'DRAFT' && (
                <button className="btn small" onClick={() => updateOfferStatus(offer.id, 'SENT')}>
                  Mark sent
                </button>
              )}
            </div>
            {offer.priceRationale && (
              <p className="small faint" style={{ marginBottom: 10 }}>
                <span className="mono-label">Why this price — </span>
                {offer.priceRationale}
              </p>
            )}
            {offer.gapAnalysis && (
              <p className="small" style={{ marginBottom: 8 }}>
                <span className="mono-label">Gap analysis — </span>
                {offer.gapAnalysis}
              </p>
            )}
            <h4 className="small" style={{ marginBottom: 4 }}>Deliverables</h4>
            <ul style={{ paddingLeft: 18, marginBottom: 10 }}>
              {offer.deliverables.map((d, i) => (
                <li key={i} className="small muted" style={{ marginBottom: 3 }}>{d}</li>
              ))}
            </ul>
            <h4 className="small" style={{ marginBottom: 4 }}>Website brief</h4>
            <p className="small" style={{ marginBottom: 6 }}>
              <span className="mono-label">Sitemap — </span>
              {offer.websiteBrief.sitemap.join(' · ')}
            </p>
            <p className="small" style={{ marginBottom: 6 }}>
              <span className="mono-label">Copy direction — </span>
              {offer.websiteBrief.copyDirection}
            </p>
            <p className="small" style={{ marginBottom: 6 }}>
              <span className="mono-label">CTA strategy — </span>
              {offer.websiteBrief.ctaStrategy}
            </p>
            {brief && (
              <>
                <h4 className="small" style={{ marginTop: 10, marginBottom: 4 }}>Design brief</h4>
                <p className="small" style={{ marginBottom: 6 }}>
                  <span className="mono-label">Homepage concept — </span>
                  {brief.homepageConcept}
                </p>
                <p className="small" style={{ marginBottom: 6 }}>
                  <span className="mono-label">Hero section — </span>
                  {brief.heroSection}
                </p>
                <p className="faint small">Asset generation: {brief.assetStatus.replace('_', ' ').toLowerCase()}</p>
              </>
            )}
          </div>
        ) : (
          ['INTERESTED', 'PROPOSAL_SENT', 'NEGOTIATING', 'WON'].includes(prospect.status) && (
            <div className="drawer-section">
              <div className="empty">
                An offer + design brief will be drafted automatically on the next research cycle.
              </div>
            </div>
          )
        )}

        {offer && (
          <div className="drawer-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <h3 style={{ margin: 0 }}>Demo website</h3>
              <div style={{ display: 'flex', gap: 6 }}>
                {demo && (
                  <button className="btn small primary" onClick={() => viewProspectDemo(prospect.id)}>
                    View demo
                  </button>
                )}
                <button className="btn small" disabled={buildingDemo} onClick={runBuildDemo}>
                  {buildingDemo ? 'Building…' : demo ? 'Rebuild demo' : 'Build demo'}
                </button>
              </div>
            </div>
            {demo ? (
              <p className="small faint">
                "{demo.heroHeadline}" — {demo.sectionsIncluded.length} section(s)
                {demo.generator === 'llm' ? ', personalized from deep research' : ''}. This is a real, working
                page you can open and send as a link — never the business's actual live site until they say
                yes.
              </p>
            ) : (
              <div className="empty">
                No demo built yet — click "Build demo" to generate a real, working preview page for{' '}
                {prospect.businessName} based on this offer.
              </div>
            )}
          </div>
        )}

        {project && (
          <div className="drawer-section">
            <h3>Delivery project — {project.status}</h3>
            <p className="faint small" style={{ marginBottom: 8 }}>
              Agreed ${project.agreedPrice} over ~{project.agreedTimelineDaysMax} days. Manage milestones from
              the Delivery Projects view.
            </p>
          </div>
        )}

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
