/* ============================================================================
 * SURVIVE AI — Delivery project tracker (Phase 3, §"OFFER + DELIVERY")
 * ----------------------------------------------------------------------------
 * A lightweight delivery project is created automatically the moment a
 * prospect reaches WON against a drafted offer. Standard milestones, agreed
 * price/timeline. This is delivery tracking only — never a second wallet;
 * real money is recorded separately in the (Phase 4) revenue ledger, not
 * created or mutated here. Pure functions, no side effects.
 * ========================================================================== */

import type { Offer, Project, ProjectMilestone, ProjectMilestoneKey, Prospect } from '../types';
import { uid } from './format';

const MILESTONE_LABELS: Record<ProjectMilestoneKey, string> = {
  KICKOFF: 'Kickoff — scope & timeline confirmed with client',
  CONTENT_COLLECTED: 'Content collected (copy, photos, logo, brand assets)',
  DESIGN_APPROVED: 'Design/mockup approved by client',
  BUILD: 'Site built against approved design',
  REVIEW: 'Client review & revision round',
  DELIVERED: 'Delivered — live and handed over',
};

function standardMilestones(now: number): ProjectMilestone[] {
  const keys: ProjectMilestoneKey[] = ['KICKOFF', 'CONTENT_COLLECTED', 'DESIGN_APPROVED', 'BUILD', 'REVIEW', 'DELIVERED'];
  return keys.map((key, i) => ({
    key,
    label: MILESTONE_LABELS[key],
    status: i === 0 ? 'active' : 'pending',
    completedAt: undefined,
  }));
}

/** Create a new delivery project the moment a prospect's offer is WON. */
export function createProjectFromWonOffer(prospect: Prospect, offer: Offer, now: number = Date.now()): Project {
  return {
    id: uid('proj'),
    prospectId: prospect.id,
    prospectName: prospect.businessName,
    offerId: offer.id,
    opportunityId: offer.opportunityId,
    agreedPrice: offer.price,
    agreedTimelineDaysMax: offer.timelineDaysMax,
    milestones: standardMilestones(now),
    status: 'ACTIVE',
    startedAt: now,
    updatedAt: now,
  };
}

/** Advance a project to (and including) the given milestone; marks everything
 *  before it done, the target 'done' too, and the next one 'active'. */
export function advanceMilestone(project: Project, key: ProjectMilestoneKey, now: number = Date.now()): Project {
  const idx = project.milestones.findIndex((m) => m.key === key);
  if (idx === -1) return project;

  const milestones = project.milestones.map((m, i) => {
    if (i < idx) return m.status === 'done' ? m : { ...m, status: 'done' as const, completedAt: m.completedAt ?? now };
    if (i === idx) return { ...m, status: 'done' as const, completedAt: now };
    if (i === idx + 1) return { ...m, status: 'active' as const };
    return m;
  });

  const delivered = key === 'DELIVERED';
  return {
    ...project,
    milestones,
    status: delivered ? 'DELIVERED' : project.status,
    deliveredAt: delivered ? now : project.deliveredAt,
    updatedAt: now,
  };
}

/** The next incomplete milestone — what recommendedActions.ts surfaces as
 *  ADVANCE_PROJECT, with urgency escalating the further past the agreed
 *  timeline the project has run without being delivered. */
export function nextIncompleteMilestone(project: Project): ProjectMilestone | undefined {
  return project.milestones.find((m) => m.status !== 'done');
}

export function isOverdue(project: Project, now: number = Date.now()): boolean {
  if (project.status !== 'ACTIVE') return false;
  const DAY_MS = 24 * 60 * 60 * 1000;
  return now - project.startedAt > project.agreedTimelineDaysMax * DAY_MS;
}
