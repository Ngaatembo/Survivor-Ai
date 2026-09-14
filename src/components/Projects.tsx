import { useMemo } from 'react';
import { useStore } from '../store';
import { Badge, Panel } from './ui';
import type { Project, ProjectMilestoneKey } from '../types';
import { isOverdue, nextIncompleteMilestone } from '../lib/projectTracker';

const STATUS_TONE: Record<Project['status'], 'green' | 'blue' | 'gray'> = {
  ACTIVE: 'blue',
  DELIVERED: 'green',
  CANCELLED: 'gray',
};

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

export function Projects() {
  const projects = useStore((s) => s.projects);
  const advanceProjectMilestone = useStore((s) => s.advanceProjectMilestone);

  const { active, delivered, overdueCount } = useMemo(() => {
    const active = projects.filter((p) => p.status === 'ACTIVE');
    const delivered = projects.filter((p) => p.status === 'DELIVERED');
    const overdueCount = active.filter((p) => isOverdue(p)).length;
    return { active, delivered, overdueCount };
  }, [projects]);

  return (
    <div className="view-enter">
      <div className="warn-banner">
        A delivery project is created automatically the moment a prospect's offer is marked WON. This is
        delivery tracking only — real money earned is recorded separately (Phase 4's revenue ledger), never
        here.
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
                      <Badge tone={STATUS_TONE[project.status]}>{project.status}</Badge>
                    </div>
                  </div>
                  <MilestoneTrack project={project} onAdvance={(key) => advanceProjectMilestone(project.id, key)} />
                  {next && project.status === 'ACTIVE' && (
                    <div className="faint small" style={{ marginTop: 8 }}>
                      Next: {next.label}
                    </div>
                  )}
                </Panel>
              );
            })}
        </div>
      )}
    </div>
  );
}
