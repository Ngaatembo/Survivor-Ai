import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { Badge, Panel } from './ui';
import type { PaymentMethod, Project, ProjectMilestoneKey } from '../types';
import { isOverdue, nextIncompleteMilestone } from '../lib/projectTracker';

const STATUS_TONE: Record<Project['status'], 'green' | 'blue' | 'gray'> = {
  ACTIVE: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'gray',
};

const PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'BANK_TRANSFER', 'MOBILE_MONEY', 'CARD', 'OTHER'];

function MilestoneTrack({ project, onAdvance }: { project: Project; onAdvance: (key: ProjectMilestoneKey) => void }) {
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
      {project.milestones.map((m) => (
        <button
          key={m.key}
          className={`stage-badge small ${m.status === 'done' ? 'lit' : ''}`}
          title={m.label}
          disabled={project.status !== 'ACTIVE' || m.status === 'done'}
          onClick={(e) => {
            e.stopPropagation();
            onAdvance(m.key);
          }}
          style={{
            cursor: project.status === 'ACTIVE' && m.status !== 'done' ? 'pointer' : 'default',
            opacity: m.status === 'pending' ? 0.5 : 1,
          }}
        >
          {m.status === 'done' ? '✓ ' : m.status === 'active' ? '▶ ' : ''}
          {m.label.split(' — ')[0]}
        </button>
      ))}
    </div>
  );
}

function RecordPaymentForm({ project, onClose }: { project: Project; onClose: () => void }) {
  const addRealRevenueEntry = useStore((s) => s.addRealRevenueEntry);
  const [amountReceived, setAmountReceived] = useState(String(project.agreedPrice));
  const [costs, setCosts] = useState('0');
  const [productService, setProductService] = useState('Website');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('MOBILE_MONEY');
  const [acquisitionChannel, setAcquisitionChannel] = useState('');
  const [daysFromDiscoveryToPayment, setDays] = useState(
    String(Math.max(0, Math.round((Date.now() - project.startedAt) / (24 * 60 * 60 * 1000)))),
  );
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setSaving(true);
    setError('');
    try {
      await addRealRevenueEntry({
        opportunityId: project.opportunityId,
        prospectId: project.prospectId,
        prospectName: project.prospectName,
        projectId: project.id,
        productService,
        quotedPrice: project.agreedPrice,
        amountReceived: Number(amountReceived) || 0,
        costs: Number(costs) || 0,
        paymentMethod,
        acquisitionChannel,
        daysFromDiscoveryToPayment: Number(daysFromDiscoveryToPayment) || 0,
        notes: notes || undefined,
      });
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ marginTop: 10, padding: 10, border: '1px solid var(--panel-3, #2a3340)', borderRadius: 8 }}>
      {error && <div className="warn-banner" style={{ marginBottom: 8 }} role="alert">Payment recording failed: {error}</div>}
      <div className="grid cols-2" style={{ gap: 8, marginBottom: 8 }}>
        <label className="small">
          Amount received (${project.agreedPrice} quoted)
          <input className="text-input" value={amountReceived} onChange={(e) => setAmountReceived(e.target.value)} />
        </label>
        <label className="small">
          Costs
          <input className="text-input" value={costs} onChange={(e) => setCosts(e.target.value)} />
        </label>
        <label className="small">
          Product/service
          <input className="text-input" value={productService} onChange={(e) => setProductService(e.target.value)} />
        </label>
        <label className="small">
          Payment method
          <select className="select" value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value as PaymentMethod)}>
            {PAYMENT_METHODS.map((m) => (
              <option key={m} value={m}>{m.replace('_', ' ')}</option>
            ))}
          </select>
        </label>
        <label className="small">
          Acquisition channel
          <input className="text-input" value={acquisitionChannel} onChange={(e) => setAcquisitionChannel(e.target.value)} placeholder="e.g. WhatsApp outreach" />
        </label>
        <label className="small">
          Days discovery → payment
          <input className="text-input" value={daysFromDiscoveryToPayment} onChange={(e) => setDays(e.target.value)} />
        </label>
      </div>
      <label className="small" style={{ display: 'block', marginBottom: 8 }}>
        Notes / objections encountered
        <textarea className="text-input" value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} style={{ width: '100%' }} />
      </label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn primary small" disabled={saving} onClick={submit}>
          {saving ? 'Saving…' : 'Record payment'}
        </button>
        <button className="btn small" disabled={saving} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

function OutcomeControls({ project }: { project: Project }) {
  const updateProjectOutcome = useStore((s) => s.updateProjectOutcome);
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
      <div className="small faint">Satisfaction:</div>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          className="stage-badge small"
          style={{ opacity: (project.satisfaction ?? 0) >= n ? 1 : 0.35, cursor: 'pointer' }}
          onClick={() => updateProjectOutcome(project.id, { satisfaction: n })}
        >
          ★
        </button>
      ))}
      <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!project.repeatPurchase}
          onChange={(e) => updateProjectOutcome(project.id, { repeatPurchase: e.target.checked })}
        />
        Repeat purchase
      </label>
      <label className="small" style={{ display: 'flex', gap: 4, alignItems: 'center', cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={!!project.referral}
          onChange={(e) => updateProjectOutcome(project.id, { referral: e.target.checked })}
        />
        Referral
      </label>
    </div>
  );
}

export function Projects() {
  const projects = useStore((s) => s.projects);
  const advanceProjectMilestone = useStore((s) => s.advanceProjectMilestone);
  const updateProjectOutcome = useStore((s) => s.updateProjectOutcome);
  const actionError = useStore((s) => s.actionError);
  const realRevenue = useStore((s) => s.realRevenue);
  const [paymentFormFor, setPaymentFormFor] = useState<string | null>(null);

  const { active, delivered, overdueCount } = useMemo(() => {
    const active = projects.filter((p) => p.status === 'ACTIVE');
    const delivered = projects.filter((p) => p.status === 'DELIVERED');
    const overdueCount = active.filter((p) => isOverdue(p)).length;
    return { active, delivered, overdueCount };
  }, [projects]);

  return (
    <div className="view-enter">
      {actionError && <div className="warn-banner" role="alert" style={{ marginBottom: 10 }}>Action failed: {actionError}</div>}

      <div className="warn-banner">
        A delivery project is created automatically the moment a prospect's offer is marked WON. Recording a
        payment below writes to the separate, append-only real-revenue ledger (Phase 4) — it never touches
        the simulated wallet.
      </div>

      <div className="grid cols-3" style={{ marginBottom: 14 }}>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Active projects</div>
            <div className="stat-value">{active.length}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Delivered</div>
            <div className="stat-value">{delivered.length}</div>
          </div>
        </Panel>
        <Panel tight>
          <div className="stat">
            <div className="stat-label">Overdue</div>
            <div className="stat-value" style={{ color: overdueCount > 0 ? 'var(--red, #e05555)' : undefined }}>
              {overdueCount}
            </div>
          </div>
        </Panel>
      </div>

      {projects.length === 0 ? (
        <div className="empty">
          No delivery projects yet — these start automatically once a prospect's offer is marked WON in
          Prospects / CRM.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {[...projects]
            .sort((a, b) => (a.status === 'ACTIVE' ? -1 : 1) - (b.status === 'ACTIVE' ? -1 : 1))
            .map((project) => {
              const next = nextIncompleteMilestone(project);
              const overdue = isOverdue(project);
              const paid = realRevenue.some((r) => r.projectId === project.id);
              return (
                <Panel key={project.id} tight>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 8 }}>
                    <div>
                      <div style={{ fontWeight: 700 }}>{project.prospectName}</div>
                      <div className="faint small mono">
                        ${project.agreedPrice} · ~{project.agreedTimelineDaysMax} day timeline
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      {overdue && <Badge tone="amber">OVERDUE</Badge>}
                      {paid && <Badge tone="green">PAID</Badge>}
                      <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
                    </div>
                  </div>
                  <MilestoneTrack project={project} onAdvance={(key) => advanceProjectMilestone(project.id, key)} />
                  {next && project.status === 'ACTIVE' && (
                    <div className="faint small" style={{ marginTop: 8 }}>
                      Next: {next.label}
                    </div>
                  )}

                  {!paid && (
                    paymentFormFor === project.id ? (
                      <RecordPaymentForm project={project} onClose={() => setPaymentFormFor(null)} />
                    ) : (
                      <button className="btn small" style={{ marginTop: 10 }} onClick={() => setPaymentFormFor(project.id)}>
                        Record payment
                      </button>
                    )
                  )}

                  {paid && <OutcomeControls project={project} />}
                </Panel>
              );
            })}
        </div>
      )}
    </div>
  );
}
