/* ============================================================================
 * Sales & Client Acquisition — Worker API + D1 persistence.
 * ----------------------------------------------------------------------------
 * Sits ON TOP of the existing prospects/verification/intelligence data:
 *  - one sales_leads row per prospect (no duplicate leads when stages change)
 *  - the older prospects.status is kept in step so existing screens stay right
 *  - all routes need the operator session; nothing here ever sends a message
 * Tables are created on first use (CREATE TABLE IF NOT EXISTS), so no manual
 * migration is required; migrations/0020_sales_system.sql documents the same
 * schema for anyone applying it by hand.
 * ========================================================================== */

import type { EngineRepository } from '../../src/engine/repository';
import type { Prospect, ProspectIntelligence } from '../../src/types';
import { parseZimPhone } from '../../src/lib/whatsappOutreach';
import type { Env } from './env';
import { buildSalesBrief, qualifyLead, type LeadContext } from '../../src/sales/intelligence';
import {
  buildActionPlan,
  buildCallGuide,
  buildCallPrep,
  FOLLOW_UP_SITUATIONS,
  generateFirstContactVariants,
  generateFollowUp,
  pickDiscoveryQuestions,
  validateOutreach,
  type FollowUpSituation,
  type MessageContext,
} from '../../src/sales/messages';
import { mergePricing, PRICING_HELP, PRICING_LABEL } from '../../src/sales/pricing';
import { buildProposalDraft } from '../../src/sales/proposals';
import { computeToday, pipelineCounts, type LeadBundle } from '../../src/sales/actions';
import { computeSalesAnalytics, type StageHistoryRow } from '../../src/sales/analytics';
import { allowedNextStages, checkTransition, isLostReason, mergeSettings, stageEffect } from '../../src/sales/settings';
import {
  LEGACY_STATUS_FOR_STAGE,
  OFFER_TYPES,
  PRICING_KEYS,
  SALES_STAGES,
  STAGE_FOR_LEGACY_STATUS,
  type ActivityKind,
  type FollowUpRow,
  type MeetingRow,
  type MessageStatus,
  type OfferType,
  type PricingSettings,
  type ProposalRow,
  type SalesActivity,
  type SalesBrief,
  type SalesLeadRow,
  type SalesMessage,
  type SalesNote,
  type SalesSettings,
  type SalesStage,
} from '../../src/sales/types';

export interface SalesDeps {
  repo: EngineRepository;
  json: (data: unknown, init?: ResponseInit) => Response;
  isOperator: () => Promise<boolean>;
}

const DAY = 24 * 60 * 60 * 1000;
const rid = (p: string) => `${p}_${crypto.randomUUID()}`;

/* --------------------------------- schema --------------------------------- */

let salesTablesReady = false;

export async function ensureSalesTables(db: D1Database): Promise<void> {
  if (salesTablesReady) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_leads (
      prospect_id TEXT PRIMARY KEY REFERENCES prospects(id) ON DELETE CASCADE,
      stage TEXT NOT NULL,
      stage_entered_at INTEGER NOT NULL,
      paused INTEGER NOT NULL DEFAULT 0,
      contact_person TEXT, phone TEXT, whatsapp TEXT, email TEXT,
      angle TEXT, recommended_channel TEXT, offer_type TEXT,
      demo_status TEXT NOT NULL DEFAULT 'NONE',
      demo_sent_at INTEGER,
      selected_message_id TEXT,
      last_contact_at INTEGER,
      next_action TEXT, next_action_at INTEGER,
      lost_reason TEXT, lost_notes TEXT,
      won_value REAL, won_at INTEGER,
      brief_json TEXT, researched_at INTEGER,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_leads_stage ON sales_leads(stage)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_stages (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      from_stage TEXT, to_stage TEXT NOT NULL, note TEXT, at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_stages_prospect ON sales_stages(prospect_id, at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_activities (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, summary TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_activities_prospect ON sales_activities(prospect_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_messages (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      kind TEXT NOT NULL, variant TEXT NOT NULL, channel TEXT, angle TEXT,
      body TEXT NOT NULL, edited_body TEXT,
      status TEXT NOT NULL DEFAULT 'DRAFT', sent_at INTEGER, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_sales_messages_prospect ON sales_messages(prospect_id, created_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      due_at INTEGER NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING', created_at INTEGER NOT NULL, done_at INTEGER
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_follow_ups_due ON follow_ups(status, due_at)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS meetings (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      scheduled_at INTEGER NOT NULL, kind TEXT NOT NULL DEFAULT 'CALL', notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'SCHEDULED', created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS proposals (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      offer_type TEXT NOT NULL, quote_json TEXT NOT NULL, scope_json TEXT NOT NULL DEFAULT '[]',
      body TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'DRAFT',
      sent_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_notes (
      id TEXT PRIMARY KEY,
      prospect_id TEXT NOT NULL REFERENCES prospects(id) ON DELETE CASCADE,
      body TEXT NOT NULL, created_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sales_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS pricing_settings (key TEXT PRIMARY KEY, value REAL, updated_at INTEGER NOT NULL)`),
  ]);
  salesTablesReady = true;
}

/* ------------------------------- row mapping ------------------------------- */

const opt = <T>(v: T | null | undefined): T | undefined => (v === null || v === undefined ? undefined : v);
const parse = <T>(s: unknown, fallback: T): T => { try { return typeof s === 'string' ? (JSON.parse(s) as T) : fallback; } catch { return fallback; } };

function toLead(r: any): SalesLeadRow {
  return {
    prospectId: r.prospect_id,
    stage: r.stage,
    stageEnteredAt: r.stage_entered_at,
    paused: Boolean(r.paused),
    contactPerson: opt(r.contact_person),
    phone: opt(r.phone),
    whatsapp: opt(r.whatsapp),
    email: opt(r.email),
    angle: opt(r.angle),
    recommendedChannel: opt(r.recommended_channel),
    offerType: opt(r.offer_type),
    demoStatus: r.demo_status ?? 'NONE',
    demoSentAt: opt(r.demo_sent_at),
    selectedMessageId: opt(r.selected_message_id),
    lastContactAt: opt(r.last_contact_at),
    nextAction: opt(r.next_action),
    nextActionAt: opt(r.next_action_at),
    lostReason: opt(r.lost_reason),
    lostNotes: opt(r.lost_notes),
    wonValue: opt(r.won_value),
    wonAt: opt(r.won_at),
    briefJson: r.brief_json ? parse<SalesBrief | undefined>(r.brief_json, undefined) : undefined,
    researchedAt: opt(r.researched_at),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
const toMessage = (r: any): SalesMessage => ({
  id: r.id, prospectId: r.prospect_id, kind: r.kind, variant: r.variant, channel: opt(r.channel), angle: opt(r.angle),
  body: r.body, editedBody: opt(r.edited_body), status: r.status as MessageStatus, sentAt: opt(r.sent_at), createdAt: r.created_at,
});
const toFollowUp = (r: any): FollowUpRow => ({
  id: r.id, prospectId: r.prospect_id, dueAt: r.due_at, kind: r.kind, note: r.note, status: r.status, createdAt: r.created_at, doneAt: opt(r.done_at),
});
const toMeeting = (r: any): MeetingRow => ({
  id: r.id, prospectId: r.prospect_id, scheduledAt: r.scheduled_at, kind: r.kind, notes: r.notes, status: r.status, createdAt: r.created_at,
});
const toProposal = (r: any): ProposalRow => ({
  id: r.id, prospectId: r.prospect_id, offerType: r.offer_type, quote: parse(r.quote_json, {} as any), scope: parse<string[]>(r.scope_json, []),
  body: r.body, status: r.status, sentAt: opt(r.sent_at), createdAt: r.created_at, updatedAt: r.updated_at,
});

/* --------------------------------- settings --------------------------------- */

async function loadSettings(db: D1Database): Promise<{ settings: SalesSettings; pricing: PricingSettings }> {
  const s = await db.prepare(`SELECT value FROM sales_settings WHERE key = 'settings'`).first<{ value: string }>();
  const { results } = await db.prepare(`SELECT key, value FROM pricing_settings`).all<{ key: string; value: number | null }>();
  const stored: Record<string, number | null> = {};
  for (const r of results) stored[r.key] = r.value;
  return { settings: mergeSettings(s ? parse<Partial<SalesSettings>>(s.value, {}) : undefined), pricing: mergePricing(stored) };
}

/* ------------------------------- shared loaders ------------------------------ */

interface World {
  prospects: Prospect[];
  byId: Map<string, Prospect>;
  intelligence: Map<string, ProspectIntelligence>;
  settings: SalesSettings;
  pricing: PricingSettings;
}

async function loadWorld(deps: SalesDeps, db: D1Database): Promise<World> {
  const [all, intel, cfg] = await Promise.all([deps.repo.listProspects(), deps.repo.listProspectIntelligence(), loadSettings(db)]);
  const prospects = all.filter((p) => p.dataSource !== 'SAMPLE');
  return {
    prospects,
    byId: new Map(prospects.map((p) => [p.id, p])),
    intelligence: new Map(intel.map((i) => [i.prospectId, i])),
    settings: cfg.settings,
    pricing: cfg.pricing,
  };
}

async function demoBuiltSet(db: D1Database): Promise<Set<string>> {
  const { results } = await db.prepare(`SELECT prospect_id FROM prospect_demos`).all<{ prospect_id: string }>();
  return new Set(results.map((r) => r.prospect_id));
}

function leadContext(w: World, p: Prospect, lead?: SalesLeadRow): LeadContext {
  return { prospect: p, intelligence: w.intelligence.get(p.id), lead, company: w.settings.company, pricing: w.pricing };
}

function messageContext(w: World, p: Prospect, lead: SalesLeadRow | undefined, demoBuilt: boolean): MessageContext {
  const base = leadContext(w, p, lead);
  return { ...base, brief: buildSalesBrief(base), demoBuilt };
}

/* --------------------------------- writers ---------------------------------- */

async function addActivity(db: D1Database, prospectId: string, kind: ActivityKind, summary: string, at = Date.now()): Promise<void> {
  await db.prepare(`INSERT INTO sales_activities (id, prospect_id, kind, summary, created_at) VALUES (?,?,?,?,?)`)
    .bind(rid('sact'), prospectId, kind, summary.slice(0, 600), at).run();
}

async function addFollowUp(db: D1Database, prospectId: string, dueAt: number, kind: string, note: string): Promise<string> {
  const id = rid('fu');
  await db.prepare(`INSERT INTO follow_ups (id, prospect_id, due_at, kind, note, status, created_at) VALUES (?,?,?,?,?,'PENDING',?)`)
    .bind(id, prospectId, dueAt, kind, note.slice(0, 300), Date.now()).run();
  return id;
}

async function supersedeSystemFollowUps(db: D1Database, prospectId: string, all: boolean): Promise<void> {
  await db.prepare(
    `UPDATE follow_ups SET status = 'SKIPPED', done_at = ? WHERE prospect_id = ? AND status = 'PENDING' ${all ? '' : "AND kind != 'CUSTOM'"}`,
  ).bind(Date.now(), prospectId).run();
}

async function importMissingLeads(db: D1Database, prospects: Prospect[]): Promise<void> {
  const { results } = await db.prepare(`SELECT prospect_id FROM sales_leads`).all<{ prospect_id: string }>();
  const have = new Set(results.map((r) => r.prospect_id));
  const missing = prospects.filter((p) => !have.has(p.id));
  if (!missing.length) return;
  const now = Date.now();
  for (let i = 0; i < missing.length; i += 25) {
    const stmts: D1PreparedStatement[] = [];
    for (const p of missing.slice(i, i + 25)) {
      const stage: SalesStage = STAGE_FOR_LEGACY_STATUS[p.status] ?? 'DISCOVERED';
      const t = p.dateDiscovered || now;
      stmts.push(
        db.prepare(
          `INSERT OR IGNORE INTO sales_leads (prospect_id, stage, stage_entered_at, last_contact_at, lost_reason, lost_notes, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?)`,
        ).bind(
          p.id, stage, p.updatedAt || now, p.lastContactAt ?? null,
          p.status === 'LOST' || p.status === 'NOT_INTERESTED' ? (p.status === 'NOT_INTERESTED' ? 'NOT_INTERESTED' : 'OTHER') : null,
          p.reasonLost ?? null, t, now,
        ),
        db.prepare(`INSERT INTO sales_stages (id, prospect_id, from_stage, to_stage, note, at) VALUES (?,?,?,?,?,?)`)
          .bind(rid('sst'), p.id, null, stage, 'Imported from existing lead record', p.updatedAt || now),
        db.prepare(`INSERT INTO sales_activities (id, prospect_id, kind, summary, created_at) VALUES (?,?,?,?,?)`)
          .bind(rid('sact'), p.id, 'LEAD_DISCOVERED', `Lead discovered${p.location ? ` in ${p.location}` : ''}.`, t),
        db.prepare(`INSERT INTO sales_activities (id, prospect_id, kind, summary, created_at) VALUES (?,?,?,?,?)`)
          .bind(rid('sact'), p.id, 'LEAD_IMPORTED', `Added to the sales pipeline at stage ${stage} (existing status ${p.status}).`, now),
      );
      if (p.nextFollowUpAt && ['CONTACTED', 'FOLLOW_UP_1', 'FOLLOW_UP_2'].includes(stage)) {
        stmts.push(
          db.prepare(`INSERT INTO follow_ups (id, prospect_id, due_at, kind, note, status, created_at) VALUES (?,?,?,?,?,'PENDING',?)`)
            .bind(rid('fu'), p.id, p.nextFollowUpAt, stage === 'CONTACTED' ? 'FOLLOW_UP_1' : 'FOLLOW_UP_2', 'Carried over from the existing CRM follow-up date.', now),
        );
      }
    }
    await db.batch(stmts);
  }
}

/* -------------------------------- stage moves ------------------------------- */

interface MoveOpts {
  note?: string;
  lostReason?: string;
  lostNotes?: string;
  wonValue?: number;
  force?: boolean;
  auto?: boolean;
  messageId?: string;
}

async function getLead(db: D1Database, id: string): Promise<SalesLeadRow | undefined> {
  const r = await db.prepare(`SELECT * FROM sales_leads WHERE prospect_id = ?`).bind(id).first();
  return r ? toLead(r) : undefined;
}

async function moveStage(
  deps: SalesDeps, db: D1Database, w: World, p: Prospect, lead: SalesLeadRow, to: SalesStage, o: MoveOpts = {},
): Promise<{ ok: true; lead: SalesLeadRow } | { ok: false; error: string }> {
  const ctx = leadContext(w, p, lead);
  const channel = buildSalesBrief(ctx).channel;
  const gate = checkTransition({
    from: lead.stage, to, hasChannel: channel.status === 'RECOMMENDED',
    qualification: qualifyLead(ctx), lostReason: o.lostReason, force: o.force,
  });
  if (!gate.ok) return gate;
  if (lead.stage === to) return { ok: true, lead };

  const now = Date.now();
  const sets: string[] = ['stage = ?', 'stage_entered_at = ?', 'updated_at = ?'];
  const binds: unknown[] = [to, now, now];
  const push = (col: string, v: unknown) => { sets.push(`${col} = ?`); binds.push(v); };

  const contactStage = to === 'CONTACTED' || to === 'FOLLOW_UP_1' || to === 'FOLLOW_UP_2';
  if (contactStage) push('last_contact_at', now);
  if (to === 'LOST') { push('lost_reason', o.lostReason); push('lost_notes', o.lostNotes?.slice(0, 500) ?? null); }
  if (to === 'NOT_A_FIT') { push('lost_reason', 'NOT_A_FIT'); push('lost_notes', o.lostNotes?.slice(0, 500) ?? o.note?.slice(0, 500) ?? null); }
  if (to === 'WON') { push('won_at', now); push('won_value', typeof o.wonValue === 'number' ? o.wonValue : null); }
  if (lead.stage === 'LOST' || lead.stage === 'NOT_A_FIT') { push('lost_reason', null); push('lost_notes', null); }

  await db.prepare(`UPDATE sales_leads SET ${sets.join(', ')} WHERE prospect_id = ?`).bind(...binds, p.id).run();
  await db.prepare(`INSERT INTO sales_stages (id, prospect_id, from_stage, to_stage, note, at) VALUES (?,?,?,?,?,?)`)
    .bind(rid('sst'), p.id, lead.stage, to, o.note ?? null, now).run();

  const label = `${lead.stage} → ${to}`;
  const kind: ActivityKind = to === 'WON' ? 'WON' : to === 'LOST' ? 'LOST' : to === 'DORMANT' ? 'DORMANT' : to === 'REPLIED' ? 'REPLY_RECEIVED' : 'STAGE_CHANGE';
  await addActivity(db, p.id, kind, `${o.auto ? '[auto] ' : ''}${label}${o.note ? ` — ${o.note}` : ''}${o.lostReason ? ` (${o.lostReason})` : ''}${typeof o.wonValue === 'number' ? ` — recorded value $${o.wonValue}` : ''}`, now);

  // Sending a message: mark the chosen draft as SENT.
  if (contactStage) {
    const msg = o.messageId
      ? await db.prepare(`SELECT * FROM sales_messages WHERE id = ? AND prospect_id = ?`).bind(o.messageId, p.id).first()
      : await db.prepare(`SELECT * FROM sales_messages WHERE prospect_id = ? AND kind = ? AND status IN ('SELECTED','DRAFT') ORDER BY (status = 'SELECTED') DESC, created_at DESC LIMIT 1`)
          .bind(p.id, to === 'CONTACTED' ? 'FIRST_CONTACT' : 'FOLLOW_UP').first();
    if (msg) {
      await db.prepare(`UPDATE sales_messages SET status = 'SENT', sent_at = ?, channel = COALESCE(channel, ?) WHERE id = ?`)
        .bind(now, lead.recommendedChannel ?? null, (msg as any).id).run();
      await addActivity(db, p.id, 'MESSAGE_SENT', `Marked as sent (${(msg as any).variant.toLowerCase().replace(/_/g, ' ')}) by you.`, now);
    } else {
      await addActivity(db, p.id, 'MESSAGE_SENT', 'Marked as contacted (no drafted message was linked).', now);
    }
  }

  // Schedule / clear follow-ups for the new stage.
  const fx = stageEffect(to, w.settings.cadence);
  let dueAt: number | undefined;
  if (fx.clearFollowUps) await supersedeSystemFollowUps(db, p.id, true);
  if (fx.followUp) {
    await supersedeSystemFollowUps(db, p.id, false);
    dueAt = now + fx.followUp.inDays * DAY;
    await addFollowUp(db, p.id, dueAt, fx.followUp.kind, fx.followUp.note);
    await addActivity(db, p.id, 'FOLLOW_UP_SCHEDULED', `${fx.followUp.note} Due ${new Date(dueAt).toISOString().slice(0, 10)}.`, now);
  }
  await db.prepare(`UPDATE sales_leads SET next_action = ?, next_action_at = ? WHERE prospect_id = ?`)
    .bind(fx.followUp?.note ?? null, dueAt ?? null, p.id).run();

  // Keep the older prospects.status column consistent for existing screens.
  const legacy = LEGACY_STATUS_FOR_STAGE[to];
  if (legacy && (legacy !== p.status || contactStage)) {
    try {
      await deps.repo.updateProspectStatus(p.id, legacy as Prospect['status'], to === 'LOST' || to === 'NOT_A_FIT' ? `${o.lostReason ?? 'NOT_A_FIT'}${o.lostNotes ? `: ${o.lostNotes}` : ''}` : undefined);
      if (dueAt) await db.prepare(`UPDATE prospects SET next_follow_up_at = ? WHERE id = ?`).bind(new Date(dueAt).toISOString(), p.id).run();
      p.status = legacy as Prospect['status'];
    } catch { /* legacy mirror is best-effort; the sales record is authoritative */ }
  }

  const updated = await getLead(db, p.id);
  return { ok: true, lead: updated! };
}

/** If a lead sat in FOLLOW_UP_2 with no reply past the dormancy window, park it. */
async function sweepDormant(deps: SalesDeps, db: D1Database, w: World, leads: SalesLeadRow[], followUps: FollowUpRow[]): Promise<boolean> {
  const now = Date.now();
  let changed = false;
  for (const l of leads) {
    if (l.stage !== 'FOLLOW_UP_2' || l.paused) continue;
    const due = followUps.find((f) => f.prospectId === l.prospectId && f.status === 'PENDING' && f.kind === 'DORMANCY_REVIEW' && f.dueAt <= now);
    const p = w.byId.get(l.prospectId);
    if (!due || !p) continue;
    const r = await moveStage(deps, db, w, p, l, 'DORMANT', { auto: true, note: 'No reply after the final follow-up.' });
    if (r.ok) changed = true;
  }
  return changed;
}

/* ---------------------------------- views ---------------------------------- */

function leadSummary(p: Prospect, l: SalesLeadRow, nextDue?: number) {
  const b = l.briefJson;
  return {
    prospectId: p.id,
    businessName: p.verification?.verifiedBusinessName || p.businessName,
    category: p.category,
    location: p.location,
    score: p.score.total,
    priority: p.priority,
    verification: p.verification?.status ?? 'UNVERIFIED',
    stage: l.stage,
    stageEnteredAt: l.stageEnteredAt,
    paused: l.paused,
    contactPerson: l.contactPerson,
    angle: l.angle,
    channel: l.recommendedChannel,
    channelStatus: b?.channel.status,
    offerType: l.offerType,
    demoStatus: l.demoStatus,
    lastContactAt: l.lastContactAt,
    nextAction: l.nextAction,
    nextActionAt: nextDue ?? l.nextActionAt,
    hasBrief: Boolean(b),
    confidence: b?.confidence,
    opportunity: b?.opportunity,
    lostReason: l.lostReason,
    wonValue: l.wonValue,
  };
}

async function loadBundles(db: D1Database, w: World): Promise<{ bundles: LeadBundle[]; leads: SalesLeadRow[]; followUps: FollowUpRow[] }> {
  const [lr, fr, mr, pr] = await Promise.all([
    db.prepare(`SELECT * FROM sales_leads`).all(),
    db.prepare(`SELECT * FROM follow_ups WHERE status = 'PENDING'`).all(),
    db.prepare(`SELECT * FROM meetings WHERE status = 'SCHEDULED'`).all(),
    db.prepare(`SELECT * FROM proposals WHERE status IN ('DRAFT','SENT')`).all(),
  ]);
  const leads = lr.results.map(toLead).filter((l) => w.byId.has(l.prospectId));
  const followUps = fr.results.map(toFollowUp);
  const meetings = mr.results.map(toMeeting);
  const proposals = pr.results.map(toProposal);
  const bundles: LeadBundle[] = leads.map((lead) => {
    const p = w.byId.get(lead.prospectId)!;
    return {
      prospectId: p.id,
      businessName: p.verification?.verifiedBusinessName || p.businessName,
      score: p.score.total,
      lead,
      followUps: followUps.filter((f) => f.prospectId === p.id),
      meetings: meetings.filter((m) => m.prospectId === p.id),
      proposals: proposals.filter((x) => x.prospectId === p.id),
    };
  });
  return { bundles, leads, followUps };
}

async function pipelineSnapshot(deps: SalesDeps, db: D1Database, w: World) {
  await importMissingLeads(db, w.prospects);
  let loaded = await loadBundles(db, w);
  if (await sweepDormant(deps, db, w, loaded.leads, loaded.followUps)) loaded = await loadBundles(db, w);
  const dueByLead = new Map<string, number>();
  for (const f of loaded.followUps) if (!dueByLead.has(f.prospectId) || f.dueAt < dueByLead.get(f.prospectId)!) dueByLead.set(f.prospectId, f.dueAt);
  return {
    leads: loaded.leads.map((l) => leadSummary(w.byId.get(l.prospectId)!, l, dueByLead.get(l.prospectId))),
    counts: pipelineCounts(loaded.leads),
    today: computeToday(loaded.bundles),
    raw: loaded,
  };
}

/* --------------------------- input sanitising helpers -------------------------- */

const str = (v: unknown, max = 200): string | undefined => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const isStage = (s: unknown): s is SalesStage => typeof s === 'string' && (SALES_STAGES as readonly string[]).includes(s);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(deps: SalesDeps, error: string, status = 400): Response {
  return deps.json({ ok: false, error }, { status });
}

function parseTime(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) { const t = Date.parse(v); if (Number.isFinite(t)) return t; }
  return undefined;
}

/** Saves the brief snapshot + derived fields onto the lead. */
async function saveSnapshot(db: D1Database, w: World, p: Prospect, lead: SalesLeadRow, demoBuilt: boolean): Promise<SalesBrief> {
  const ctx = leadContext(w, p, lead);
  const brief = buildSalesBrief(ctx);
  const demoStatus = lead.demoStatus === 'SENT' ? 'SENT' : demoBuilt ? 'BUILT' : brief.demo.recommended ? 'RECOMMENDED' : 'NONE';
  await db.prepare(
    `UPDATE sales_leads SET brief_json = ?, angle = ?, recommended_channel = ?, offer_type = ?, demo_status = ?, researched_at = ?, updated_at = ? WHERE prospect_id = ?`,
  ).bind(JSON.stringify(brief), brief.angle, brief.channel.channel ?? null, brief.offer.offer, demoStatus, brief.generatedAt, Date.now(), p.id).run();
  return brief;
}

/* --------------------------------- router ---------------------------------- */

export async function handleSalesRoute(req: Request, env: Env, url: URL, deps: SalesDeps): Promise<Response | null> {
  if (!url.pathname.startsWith('/sales/')) return null;
  if (env.DB_BACKEND !== 'd1') return fail(deps, 'The sales system requires the D1 backend.', 501);
  if (!(await deps.isOperator())) return fail(deps, 'operator authentication required', 401);
  const db = env.DB;
  const path = url.pathname;
  const method = req.method;

  try {
    await ensureSalesTables(db);

    let body: any = {};
    if (method === 'POST') {
      try { body = await req.json(); } catch { return fail(deps, 'invalid JSON body'); }
    }
    const w = await loadWorld(deps, db);
    const prospectIdOf = (b: any) => (typeof b?.prospectId === 'string' ? b.prospectId : '');

    /* ------------------------------ read routes ----------------------------- */

    if (path === '/sales/pipeline' && method === 'GET') {
      const snap = await pipelineSnapshot(deps, db, w);
      return deps.json({ ok: true, leads: snap.leads, counts: snap.counts, today: snap.today, generatedAt: Date.now() });
    }

    if (path === '/sales/today' && method === 'GET') {
      const snap = await pipelineSnapshot(deps, db, w);
      return deps.json({ ok: true, today: snap.today, counts: snap.counts });
    }

    if (path === '/sales/analytics' && method === 'GET') {
      await importMissingLeads(db, w.prospects);
      const [lr, hr, mr] = await Promise.all([
        db.prepare(`SELECT * FROM sales_leads`).all(),
        db.prepare(`SELECT prospect_id, from_stage, to_stage, at FROM sales_stages`).all(),
        db.prepare(`SELECT * FROM sales_messages`).all(),
      ]);
      const leads = lr.results.map(toLead).filter((l) => w.byId.has(l.prospectId));
      const history: StageHistoryRow[] = hr.results.map((r: any) => ({ prospectId: r.prospect_id, fromStage: opt(r.from_stage), toStage: r.to_stage, at: r.at }));
      const messages = mr.results.map(toMessage);
      return deps.json({ ok: true, analytics: computeSalesAnalytics(leads, history, messages) });
    }

    if (path === '/sales/settings' && method === 'GET') {
      return deps.json({ ok: true, settings: w.settings, pricing: w.pricing, pricingLabels: PRICING_LABEL, pricingHelp: PRICING_HELP });
    }

    if (path === '/sales/lead' && method === 'GET') {
      const id = url.searchParams.get('prospectId') ?? '';
      const p = w.byId.get(id);
      if (!p) return fail(deps, `no lead found with id ${id}`, 404);
      await importMissingLeads(db, [p]);
      const lead = (await getLead(db, id))!;
      const [mr, fr, mtr, pr, nr, ar, hr, demos, offers] = await Promise.all([
        db.prepare(`SELECT * FROM sales_messages WHERE prospect_id = ? ORDER BY created_at DESC`).bind(id).all(),
        db.prepare(`SELECT * FROM follow_ups WHERE prospect_id = ? ORDER BY due_at DESC LIMIT 50`).bind(id).all(),
        db.prepare(`SELECT * FROM meetings WHERE prospect_id = ? ORDER BY scheduled_at DESC`).bind(id).all(),
        db.prepare(`SELECT * FROM proposals WHERE prospect_id = ? ORDER BY created_at DESC`).bind(id).all(),
        db.prepare(`SELECT * FROM sales_notes WHERE prospect_id = ? ORDER BY created_at DESC`).bind(id).all(),
        db.prepare(`SELECT * FROM sales_activities WHERE prospect_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 200`).bind(id).all(),
        db.prepare(`SELECT * FROM sales_stages WHERE prospect_id = ? ORDER BY at ASC`).bind(id).all(),
        demoBuiltSet(db),
        db.prepare(`SELECT status, price FROM offers WHERE prospect_id = ? LIMIT 1`).bind(id).first(),
      ]);
      const ctx = messageContext(w, p, lead, demos.has(id));
      const cadence = w.settings.cadence;
      const brief = ctx.brief;
      const phone = brief.channel.channel === 'WHATSAPP' || brief.channel.channel === 'PHONE_CALL' ? parseZimPhone(brief.channel.target) : null;
      return deps.json({
        ok: true,
        lead: leadSummary(p, lead),
        contact: {
          contactPerson: lead.contactPerson ?? null, phone: lead.phone ?? null, whatsapp: lead.whatsapp ?? null, email: lead.email ?? null,
          recordedContact: p.contactValue ?? null, socialLinks: p.socialLinks, website: p.verification?.verifiedWebsiteUrl || p.websiteUrl || null,
          whatsappNumber: phone?.isMobile || brief.channel.channel === 'WHATSAPP' ? phone?.international ?? null : null,
          callNumber: phone ? `+${phone.international}` : null,
        },
        prospect: {
          id: p.id, businessName: p.businessName, category: p.category, location: p.location, websitePresence: p.websitePresence,
          score: p.score.total, scoreFactors: p.score.factors, priority: p.priority, evidenceNotes: p.evidenceNotes,
          verification: p.verification ? { status: p.verification.status, confidence: p.verification.confidence, independentSources: p.verification.independentSources } : null,
          sources: p.sources.slice(0, 8).map((s) => ({ title: s.title, url: s.url })),
        },
        state: {
          stage: lead.stage, allowedNext: allowedNextStages(lead.stage), paused: lead.paused, lostReason: lead.lostReason ?? null,
          lostNotes: lead.lostNotes ?? null, wonValue: lead.wonValue ?? null, lastContactAt: lead.lastContactAt ?? null,
          demoStatus: lead.demoStatus, demoBuilt: demos.has(id), existingOffer: offers ?? null, researchedAt: lead.researchedAt ?? null,
        },
        brief,
        messages: mr.results.map(toMessage),
        followUps: fr.results.map(toFollowUp),
        meetings: mtr.results.map(toMeeting),
        proposals: pr.results.map(toProposal),
        notes: nr.results.map((r: any): SalesNote => ({ id: r.id, prospectId: r.prospect_id, body: r.body, createdAt: r.created_at })),
        activities: ar.results.map((r: any): SalesActivity => ({ id: r.id, prospectId: r.prospect_id, kind: r.kind, summary: r.summary, createdAt: r.created_at })),
        history: hr.results.map((r: any) => ({ from: r.from_stage, to: r.to_stage, note: r.note, at: r.at })),
        discoveryQuestions: pickDiscoveryQuestions(ctx, 4),
        callPrep: buildCallPrep(ctx),
        callGuide: buildCallGuide(ctx),
        actionPlan: buildActionPlan(ctx, cadence),
        followUpSituations: FOLLOW_UP_SITUATIONS,
        pricing: w.pricing,
      });
    }

    /* ----------------------------- write routes ----------------------------- */

    if (method !== 'POST') return fail(deps, 'not found', 404);

    if (path === '/sales/settings') {
      const now = Date.now();
      const current = w.settings;
      const merged = mergeSettings({ company: { ...current.company, ...(body.company ?? {}) }, cadence: { ...current.cadence, ...(body.cadence ?? {}) } });
      await db.prepare(`INSERT INTO sales_settings (key, value, updated_at) VALUES ('settings', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
        .bind(JSON.stringify(merged), now).run();
      if (body.pricing && typeof body.pricing === 'object') {
        for (const k of PRICING_KEYS) {
          if (!(k in body.pricing)) continue;
          const raw = body.pricing[k];
          const val = raw === null || raw === '' ? null : Number(raw);
          if (val !== null && (!Number.isFinite(val) || val < 0 || val > 1_000_000)) return fail(deps, `${PRICING_LABEL[k]} must be a positive number or empty.`);
          await db.prepare(`INSERT INTO pricing_settings (key, value, updated_at) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
            .bind(k, val, now).run();
        }
      }
      const fresh = await loadSettings(db);
      return deps.json({ ok: true, settings: fresh.settings, pricing: fresh.pricing });
    }

    const prospectId = prospectIdOf(body);
    const idBased = ['/sales/message/select', '/sales/follow-up/done', '/sales/meeting/update', '/sales/proposal/status'];
    if (!idBased.includes(path)) {
      if (!prospectId) return fail(deps, 'prospectId is required');
    }
    const p = prospectId ? w.byId.get(prospectId) : undefined;
    if (prospectId && !p) return fail(deps, `no lead found with id ${prospectId}`, 404);
    if (p) await importMissingLeads(db, [p]);
    let lead = p ? (await getLead(db, p.id)) : undefined;

    /* ---- research ---- */
    if (path === '/sales/research' && p && lead) {
      const demos = await demoBuiltSet(db);
      const notes: string[] = [];
      let brief = await saveSnapshot(db, w, p, lead, demos.has(p.id));
      lead = (await getLead(db, p.id))!;
      if (lead.stage === 'DISCOVERED') {
        const r = await moveStage(deps, db, w, p, lead, 'QUALIFIED', { note: 'Qualified by sales research.' });
        if (r.ok) lead = r.lead; else notes.push(r.error);
      }
      if (lead.stage === 'QUALIFIED') {
        const r = await moveStage(deps, db, w, p, lead, 'RESEARCHED', { note: 'Sales brief generated.' });
        if (r.ok) lead = r.lead; else notes.push(r.error);
      }
      brief = (await getLead(db, p.id))?.briefJson ?? brief;
      await addActivity(db, p.id, 'RESEARCH_COMPLETED', `Sales brief generated: ${brief.opportunity} Confidence ${brief.confidence}. Channel: ${brief.channel.status === 'RECOMMENDED' ? brief.channel.channel : 'NO_DIRECT_CHANNEL'}.`);
      return deps.json({ ok: true, brief, lead: leadSummary(p, (await getLead(db, p.id))!), notes });
    }

    /* ---- message generation ---- */
    if (path === '/sales/message/generate' && p && lead) {
      if (['WON', 'LOST', 'NOT_A_FIT'].includes(lead.stage)) return fail(deps, `This lead is ${lead.stage}; reopen it before drafting outreach.`, 409);
      const demos = await demoBuiltSet(db);
      const ctx = messageContext(w, p, lead, demos.has(p.id));
      if (ctx.brief.channel.status === 'NO_DIRECT_CHANNEL') {
        return fail(deps, 'NO_DIRECT_CHANNEL: no reliable contact channel is on record. Find decision-maker/contact information manually and add it to the lead first.', 409);
      }
      if (lead.stage === 'DISCOVERED' && !ctx.brief.qualification.qualified) {
        return fail(deps, `Qualify the lead first: ${ctx.brief.qualification.blockers.join(' ')}`, 409);
      }
      await saveSnapshot(db, w, p, lead, demos.has(p.id));
      const variants = generateFirstContactVariants(ctx);
      await db.prepare(`DELETE FROM sales_messages WHERE prospect_id = ? AND kind = 'FIRST_CONTACT' AND status = 'DRAFT'`).bind(p.id).run();
      const now = Date.now();
      const stored: SalesMessage[] = [];
      for (const v of variants) {
        const m: SalesMessage = { id: rid('smsg'), prospectId: p.id, kind: 'FIRST_CONTACT', variant: v.variant, channel: v.channel, angle: ctx.brief.angle, body: v.subject ? `Subject: ${v.subject}\n\n${v.body}` : v.body, status: 'DRAFT', createdAt: now };
        await db.prepare(`INSERT INTO sales_messages (id, prospect_id, kind, variant, channel, angle, body, status, created_at) VALUES (?,?,?,?,?,?,?,'DRAFT',?)`)
          .bind(m.id, p.id, m.kind, m.variant, m.channel ?? null, m.angle ?? null, m.body, now).run();
        stored.push(m);
      }
      await addActivity(db, p.id, 'MESSAGE_GENERATED', `${variants.length} first-contact message variant(s) generated (${variants.map((v) => v.label).join(', ')}) for ${ctx.brief.channel.channel}.`);
      return deps.json({ ok: true, messages: stored, warnings: Object.fromEntries(variants.map((v, i) => [stored[i].id, v.warnings])), brief: ctx.brief });
    }

    if (path === '/sales/message/select') {
      const messageId = str(body.messageId, 100);
      if (!messageId) return fail(deps, 'messageId is required');
      const row: any = await db.prepare(`SELECT * FROM sales_messages WHERE id = ?`).bind(messageId).first();
      if (!row) return fail(deps, 'message not found', 404);
      const mp = w.byId.get(row.prospect_id);
      if (!mp) return fail(deps, 'lead not found', 404);
      const edited = typeof body.editedBody === 'string' ? body.editedBody.trim().slice(0, 4000) : undefined;
      await db.prepare(`UPDATE sales_messages SET status = 'DRAFT' WHERE prospect_id = ? AND kind = ? AND status = 'SELECTED'`).bind(row.prospect_id, row.kind).run();
      await db.prepare(`UPDATE sales_messages SET status = 'SELECTED', edited_body = COALESCE(?, edited_body) WHERE id = ?`).bind(edited || null, messageId).run();
      await db.prepare(`UPDATE sales_leads SET selected_message_id = ?, updated_at = ? WHERE prospect_id = ?`).bind(messageId, Date.now(), row.prospect_id).run();
      await addActivity(db, row.prospect_id, 'MESSAGE_SELECTED', `Selected the ${String(row.variant).toLowerCase().replace(/_/g, ' ')} message${edited ? ' (edited)' : ''}.`);
      let l = (await getLead(db, row.prospect_id))!;
      let stageNote: string | undefined;
      if (row.kind === 'FIRST_CONTACT' && (l.stage === 'QUALIFIED' || l.stage === 'RESEARCHED')) {
        const r = await moveStage(deps, db, w, mp, l, 'READY_TO_CONTACT', { note: 'First message chosen.' });
        if (r.ok) l = r.lead; else stageNote = r.error;
      }
      const demos = await demoBuiltSet(db);
      const brief = messageContext(w, mp, l, demos.has(mp.id)).brief;
      return deps.json({ ok: true, warnings: validateOutreach(edited ?? row.edited_body ?? row.body, brief), stageNote, lead: leadSummary(mp, l) });
    }

    /* ---- follow-up generation & scheduling ---- */
    if (path === '/sales/follow-up/generate' && p && lead) {
      const situation = body.situation as FollowUpSituation;
      if (!FOLLOW_UP_SITUATIONS.some((s) => s.key === situation)) return fail(deps, `situation must be one of: ${FOLLOW_UP_SITUATIONS.map((s) => s.key).join(', ')}`);
      const demos = await demoBuiltSet(db);
      const ctx = messageContext(w, p, lead, demos.has(p.id));
      const lastProposal: any = await db.prepare(`SELECT sent_at FROM proposals WHERE prospect_id = ? AND status = 'SENT' ORDER BY sent_at DESC LIMIT 1`).bind(p.id).first();
      const sentOn = lastProposal?.sent_at ? new Date(lastProposal.sent_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : undefined;
      const fu = generateFollowUp(ctx, situation, w.settings.cadence, sentOn);
      await db.prepare(`DELETE FROM sales_messages WHERE prospect_id = ? AND kind = 'FOLLOW_UP' AND variant = ? AND status = 'DRAFT'`).bind(p.id, situation).run();
      const m: SalesMessage = { id: rid('smsg'), prospectId: p.id, kind: 'FOLLOW_UP', variant: situation, channel: ctx.brief.channel.channel, angle: ctx.brief.angle, body: fu.message, status: 'DRAFT', createdAt: Date.now() };
      await db.prepare(`INSERT INTO sales_messages (id, prospect_id, kind, variant, channel, angle, body, status, created_at) VALUES (?,?,?,?,?,?,?,'DRAFT',?)`)
        .bind(m.id, p.id, m.kind, m.variant, m.channel ?? null, m.angle ?? null, m.body, m.createdAt).run();
      await addActivity(db, p.id, 'FOLLOW_UP_GENERATED', `Follow-up drafted: ${fu.title}.`);
      return deps.json({ ok: true, followUp: fu, message: m });
    }

    if (path === '/sales/follow-up/schedule' && p) {
      const due = parseTime(body.dueAt) ?? (typeof body.inDays === 'number' && body.inDays >= 0 && body.inDays <= 365 ? Date.now() + body.inDays * DAY : undefined);
      if (!due) return fail(deps, 'dueAt (date) or inDays is required');
      const note = str(body.note, 300) ?? 'Follow up with this lead.';
      await addFollowUp(db, p.id, due, 'CUSTOM', note);
      await db.prepare(`UPDATE sales_leads SET next_action = ?, next_action_at = ?, updated_at = ? WHERE prospect_id = ?`).bind(note, due, Date.now(), p.id).run();
      await db.prepare(`UPDATE prospects SET next_follow_up_at = ? WHERE id = ?`).bind(new Date(due).toISOString(), p.id).run();
      await addActivity(db, p.id, 'FOLLOW_UP_SCHEDULED', `${note} Due ${new Date(due).toISOString().slice(0, 10)}.`);
      return deps.json({ ok: true, dueAt: due });
    }

    if (path === '/sales/follow-up/done') {
      const id = str(body.id, 100);
      const status = body.status === 'SKIPPED' ? 'SKIPPED' : 'DONE';
      if (!id) return fail(deps, 'id is required');
      const row: any = await db.prepare(`SELECT * FROM follow_ups WHERE id = ?`).bind(id).first();
      if (!row) return fail(deps, 'follow-up not found', 404);
      await db.prepare(`UPDATE follow_ups SET status = ?, done_at = ? WHERE id = ?`).bind(status, Date.now(), id).run();
      await addActivity(db, row.prospect_id, 'FOLLOW_UP_DONE', `Follow-up ${status.toLowerCase()}: ${row.note}`);
      return deps.json({ ok: true });
    }

    /* ---- stage changes ---- */
    if ((path === '/sales/stage' || path === '/sales/won' || path === '/sales/lost' || path === '/sales/disqualify') && p && lead) {
      const to: SalesStage | undefined = path === '/sales/won' ? 'WON' : path === '/sales/lost' ? 'LOST' : path === '/sales/disqualify' ? 'NOT_A_FIT' : isStage(body.stage) ? body.stage : undefined;
      if (!to) return fail(deps, `stage must be one of: ${SALES_STAGES.join(', ')}`);
      const rawValue = body.wonValue ?? body.value;
      const wonValue = rawValue !== undefined && rawValue !== null && rawValue !== '' ? Number(rawValue) : undefined;
      if (wonValue !== undefined && (!Number.isFinite(wonValue) || wonValue < 0)) return fail(deps, 'wonValue must be a positive number');
      const lostReason = body.lostReason ?? body.reason;
      if (to === 'LOST' && !isLostReason(lostReason)) return fail(deps, 'A valid lost reason is required.');
      const r = await moveStage(deps, db, w, p, lead, to, {
        note: str(body.note, 400), lostReason: isLostReason(lostReason) ? lostReason : undefined, lostNotes: str(body.lostNotes ?? body.notes, 500),
        wonValue, force: body.force === true, messageId: str(body.messageId, 100),
      });
      if (!r.ok) return fail(deps, r.error, 409);
      return deps.json({ ok: true, lead: leadSummary(p, r.lead) });
    }

    if (path === '/sales/pause' && p && lead) {
      const paused = body.paused !== false;
      await db.prepare(`UPDATE sales_leads SET paused = ?, updated_at = ? WHERE prospect_id = ?`).bind(paused ? 1 : 0, Date.now(), p.id).run();
      await addActivity(db, p.id, paused ? 'PAUSED' : 'RESUMED', paused ? 'Lead paused — it will not appear in today\'s actions.' : 'Lead resumed.');
      return deps.json({ ok: true, paused });
    }

    /* ---- lead details, activity, notes ---- */
    if (path === '/sales/lead/update' && p && lead) {
      const changes: string[] = [];
      const sets: string[] = [];
      const binds: unknown[] = [];
      const setField = (col: string, val: string | null, label: string) => { sets.push(`${col} = ?`); binds.push(val); changes.push(label); };
      if ('contactPerson' in body) setField('contact_person', str(body.contactPerson, 120) ?? null, 'contact person');
      for (const [key, col] of [['phone', 'phone'], ['whatsapp', 'whatsapp']] as const) {
        if (key in body) {
          const raw = str(body[key], 40);
          if (raw && !parseZimPhone(raw)) return fail(deps, `${key} is not a valid Zimbabwe number (use e.g. 0772 123 456 or +263 77 212 3456).`);
          setField(col, raw ?? null, key);
        }
      }
      if ('email' in body) {
        const e = str(body.email, 120);
        if (e && !EMAIL_RE.test(e)) return fail(deps, 'email is not valid');
        setField('email', e ?? null, 'email');
      }
      let demoJustSent = false;
      if (body.demoStatus === 'SENT' && lead.demoStatus !== 'SENT') {
        sets.push('demo_status = ?', 'demo_sent_at = ?'); binds.push('SENT', Date.now()); changes.push('demo marked as sent');
        demoJustSent = true;
      }
      if (!sets.length) return fail(deps, 'nothing to update');
      sets.push('updated_at = ?'); binds.push(Date.now());
      await db.prepare(`UPDATE sales_leads SET ${sets.join(', ')} WHERE prospect_id = ?`).bind(...binds, p.id).run();
      await addActivity(db, p.id, demoJustSent ? 'DEMO_SENT' : 'LEAD_UPDATED', `Updated: ${changes.join(', ')}.`);
      if (demoJustSent) {
        const due = Date.now() + w.settings.cadence.demoFeedbackDays * DAY;
        await addFollowUp(db, p.id, due, 'CUSTOM', 'Ask for feedback on the demo you sent.');
        await addActivity(db, p.id, 'FOLLOW_UP_SCHEDULED', `Ask for demo feedback. Due ${new Date(due).toISOString().slice(0, 10)}.`);
      }
      lead = (await getLead(db, p.id))!;
      const demos = await demoBuiltSet(db);
      await saveSnapshot(db, w, p, lead, demos.has(p.id)); // contact details may change the recommended channel
      return deps.json({ ok: true, lead: leadSummary(p, (await getLead(db, p.id))!) });
    }

    if (path === '/sales/activity' && p) {
      const kind = body.kind as string;
      if (!['NOTE', 'CALL', 'REPLY_RECEIVED'].includes(kind)) return fail(deps, 'kind must be NOTE, CALL or REPLY_RECEIVED');
      const summary = str(body.summary, 600);
      if (!summary) return fail(deps, 'summary is required');
      await addActivity(db, p.id, kind as ActivityKind, summary);
      if (kind === 'NOTE') await db.prepare(`INSERT INTO sales_notes (id, prospect_id, body, created_at) VALUES (?,?,?,?)`).bind(rid('snote'), p.id, summary, Date.now()).run();
      return deps.json({ ok: true });
    }

    /* ---- meetings ---- */
    if (path === '/sales/meeting' && p && lead) {
      const at = parseTime(body.scheduledAt);
      if (!at) return fail(deps, 'scheduledAt (date/time) is required');
      const kind = ['CALL', 'VIDEO', 'VISIT'].includes(body.kind) ? body.kind : 'CALL';
      await db.prepare(`INSERT INTO meetings (id, prospect_id, scheduled_at, kind, notes, status, created_at) VALUES (?,?,?,?,?,'SCHEDULED',?)`)
        .bind(rid('mtg'), p.id, at, kind, str(body.notes, 400) ?? '', Date.now()).run();
      await addActivity(db, p.id, 'MEETING_BOOKED', `${kind.toLowerCase()} booked for ${new Date(at).toISOString().slice(0, 16).replace('T', ' ')}.`);
      let stageNote: string | undefined;
      if (lead.stage !== 'MEETING') {
        const r = await moveStage(deps, db, w, p, lead, 'MEETING', { note: 'Meeting booked.' });
        if (!r.ok) stageNote = r.error;
      }
      return deps.json({ ok: true, stageNote, lead: leadSummary(p, (await getLead(db, p.id))!) });
    }

    if (path === '/sales/meeting/update') {
      const id = str(body.id, 100);
      const status = body.status;
      if (!id || !['DONE', 'CANCELLED', 'SCHEDULED'].includes(status)) return fail(deps, 'id and status (DONE, CANCELLED, SCHEDULED) are required');
      const row: any = await db.prepare(`SELECT * FROM meetings WHERE id = ?`).bind(id).first();
      if (!row) return fail(deps, 'meeting not found', 404);
      await db.prepare(`UPDATE meetings SET status = ? WHERE id = ?`).bind(status, id).run();
      if (status === 'DONE') await addActivity(db, row.prospect_id, 'MEETING_DONE', 'Meeting completed.');
      return deps.json({ ok: true });
    }

    /* ---- proposals ---- */
    if (path === '/sales/proposal' && p && lead) {
      if (['WON', 'LOST', 'NOT_A_FIT'].includes(lead.stage)) return fail(deps, `This lead is ${lead.stage}.`, 409);
      const demos = await demoBuiltSet(db);
      const ctx = messageContext(w, p, lead, demos.has(p.id));
      const offer: OfferType = (OFFER_TYPES as readonly string[]).includes(body.offerType) ? body.offerType : ctx.brief.offer.offer;
      const extra = Array.isArray(body.extraScope) ? body.extraScope.map((s: unknown) => str(s, 200)).filter(Boolean) as string[] : [];
      const draft = buildProposalDraft(ctx, offer, w.pricing, extra);
      const now = Date.now();
      const row: ProposalRow = { id: rid('prop'), prospectId: p.id, status: 'DRAFT', createdAt: now, updatedAt: now, ...draft };
      await db.prepare(`INSERT INTO proposals (id, prospect_id, offer_type, quote_json, scope_json, body, status, created_at, updated_at) VALUES (?,?,?,?,?,?,'DRAFT',?,?)`)
        .bind(row.id, p.id, row.offerType, JSON.stringify(row.quote), JSON.stringify(row.scope), row.body, now, now).run();
      await addActivity(db, p.id, 'PROPOSAL_CREATED', `Proposal drafted: ${offer}${draft.quote.priceStatus === 'PRICED' ? ` — $${draft.quote.oneOffTotal} once-off` : ' — PRICE MANUAL_REVIEW_REQUIRED'}.`);
      return deps.json({ ok: true, proposal: row });
    }

    if (path === '/sales/proposal/status') {
      const id = str(body.id, 100);
      const status = body.status;
      if (!id || !['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'].includes(status)) return fail(deps, 'id and status (DRAFT, SENT, ACCEPTED, REJECTED) are required');
      const row: any = await db.prepare(`SELECT * FROM proposals WHERE id = ?`).bind(id).first();
      if (!row) return fail(deps, 'proposal not found', 404);
      const pp = w.byId.get(row.prospect_id);
      if (!pp) return fail(deps, 'lead not found', 404);
      const now = Date.now();
      const newBody = typeof body.body === 'string' && body.body.trim() ? body.body.trim().slice(0, 8000) : undefined;
      if (status === 'SENT' && parse<any>(row.quote_json, {}).priceStatus === 'MANUAL_REVIEW_REQUIRED' && body.acknowledgeManualPrice !== true) {
        return fail(deps, 'This proposal has unconfirmed prices (MANUAL_REVIEW_REQUIRED). Set the prices in Settings and create a new draft, or confirm you have priced it by hand.', 409);
      }
      await db.prepare(`UPDATE proposals SET status = ?, body = COALESCE(?, body), sent_at = CASE WHEN ? = 'SENT' THEN ? ELSE sent_at END, updated_at = ? WHERE id = ?`)
        .bind(status, newBody ?? null, status, now, now, id).run();
      const kind: ActivityKind = status === 'SENT' ? 'PROPOSAL_SENT' : status === 'ACCEPTED' ? 'PROPOSAL_ACCEPTED' : status === 'REJECTED' ? 'PROPOSAL_REJECTED' : 'PROPOSAL_CREATED';
      await addActivity(db, row.prospect_id, kind, `Proposal ${status.toLowerCase()}.`);
      let stageNote: string | undefined;
      if (status === 'SENT') {
        const l = (await getLead(db, row.prospect_id))!;
        if (l.stage !== 'PROPOSAL') {
          const r = await moveStage(deps, db, w, pp, l, 'PROPOSAL', { note: 'Proposal sent.' });
          if (!r.ok) stageNote = r.error;
        }
      }
      return deps.json({ ok: true, stageNote, hint: status === 'ACCEPTED' ? 'Mark the lead WON (with the agreed value) to close it.' : undefined });
    }

    return fail(deps, 'not found', 404);
  } catch (e) {
    return deps.json({ ok: false, error: (e as Error).message }, { status: 500 });
  }
}
