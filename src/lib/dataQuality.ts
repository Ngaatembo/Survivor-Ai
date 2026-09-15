/* ============================================================================
 * Data quality diagnostics (build-spec §44).
 * ----------------------------------------------------------------------------
 * Pure function over already-fetched dashboard state — no new backend
 * endpoint needed, works identically in live-backend and standalone demo
 * mode. Surfaces real, checkable problems (orphaned records, duplicates,
 * known-risky sources) so they're visible in the Architecture & Safety
 * view instead of only discoverable by hand via SQL.
 * ========================================================================== */

import type { Offer, Project, Prospect, RealRevenueEntry } from '../types';

export type DataQualitySeverity = 'HIGH' | 'MEDIUM' | 'LOW';

export interface DataQualityIssue {
  id: string;
  severity: DataQualitySeverity;
  category: string;
  message: string;
  entityId?: string;
}

/** A Facebook GROUP is a community, not a business — content posted
 *  within it belongs to whichever member posted it, never reliably to
 *  the group's own name. Discovery/deep-research now skip these sources
 *  entirely going forward (see prospectDiscovery.ts/prospectIntelligence.ts),
 *  but this flags anything already in the database from before that fix. */
function isFacebookGroupUrl(url?: string): boolean {
  return Boolean(url && /facebook\.com\/groups\//i.test(url));
}

/** Same shape as prospectDiscovery.ts's looksLikeRealPhoneNumber() — a
 *  contact value stored before that fix could be a decimal-formatted
 *  figure (e.g. an exchange rate) misparsed as a phone number, rather
 *  than an actual dialable number. */
function looksLikeGarbagePhoneNumber(value?: string): boolean {
  if (!value) return false;
  if (value.includes('.')) return true; // real numbers don't use '.' as a group separator
  const digits = value.replace(/\D/g, '');
  return digits.length < 7 || digits.length > 13;
}

export function computeDataQualityIssues(input: {
  prospects: Prospect[];
  offers: Offer[];
  projects: Project[];
  realRevenue: RealRevenueEntry[];
}): DataQualityIssue[] {
  const issues: DataQualityIssue[] = [];

  // 1. Prospects whose evidence includes a Facebook group post — the
  // exact bug pattern that misattributed a stranger's phone number to a
  // "business" that was actually just a Facebook group's name.
  for (const p of input.prospects) {
    if (p.sources.some((s) => isFacebookGroupUrl(s.url))) {
      issues.push({
        id: `fbgroup-${p.id}`,
        severity: 'HIGH',
        category: 'Discovered from a Facebook group',
        message: `"${p.businessName}" was discovered from a Facebook group post. The group's name may have been misparsed as the business name, and any contact info may belong to an unrelated group member — verify manually before contacting.`,
        entityId: p.id,
      });
    }
    if (p.contactChannel === 'PHONE' && looksLikeGarbagePhoneNumber(p.contactValue)) {
      issues.push({
        id: `badphone-${p.id}`,
        severity: 'HIGH',
        category: 'Implausible phone number',
        message: `"${p.businessName}"'s stored contact number "${p.contactValue}" doesn't look like a real phone number — it may be a decimal figure or other text misparsed from the source article. Do not call before verifying manually.`,
        entityId: p.id,
      });
    }
  }

  // 2. Duplicate prospects — same business name, same opportunity.
  const byKey = new Map<string, Prospect[]>();
  for (const p of input.prospects) {
    const key = `${p.opportunityId}::${p.businessName.trim().toLowerCase()}`;
    byKey.set(key, [...(byKey.get(key) ?? []), p]);
  }
  for (const group of byKey.values()) {
    if (group.length > 1) {
      issues.push({
        id: `dup-${group[0].id}`,
        severity: 'MEDIUM',
        category: 'Duplicate prospect',
        message: `${group.length} separate records exist for "${group[0].businessName}" under the same opportunity.`,
      });
    }
  }

  // 3. Orphaned offers — reference a prospect that no longer exists.
  const prospectIds = new Set(input.prospects.map((p) => p.id));
  for (const o of input.offers) {
    if (!prospectIds.has(o.prospectId)) {
      issues.push({
        id: `orphan-offer-${o.id}`,
        severity: 'HIGH',
        category: 'Orphaned offer',
        message: `Offer for "${o.prospectName}" references a prospect record that no longer exists.`,
        entityId: o.id,
      });
    }
  }

  // 4. Orphaned projects — reference an offer that no longer exists.
  const offerIds = new Set(input.offers.map((o) => o.id));
  for (const proj of input.projects) {
    if (!offerIds.has(proj.offerId)) {
      issues.push({
        id: `orphan-project-${proj.id}`,
        severity: 'HIGH',
        category: 'Orphaned project',
        message: `Delivery project for "${proj.prospectName}" references an offer that no longer exists.`,
        entityId: proj.id,
      });
    }
  }

  // 5. Orphaned real-revenue entries — reference a project that no
  // longer exists (this would mean money is recorded with no delivery
  // trail behind it, worth a human's attention).
  const projectIds = new Set(input.projects.map((p) => p.id));
  for (const r of input.realRevenue) {
    if (!projectIds.has(r.projectId)) {
      issues.push({
        id: `orphan-revenue-${r.id}`,
        severity: 'HIGH',
        category: 'Orphaned revenue record',
        message: `A recorded payment of $${r.amountReceived.toFixed(2)} from "${r.prospectName}" references a project that no longer exists.`,
        entityId: r.id,
      });
    }
  }

  return issues;
}
