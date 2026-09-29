/* ============================================================================
 * Sales & Client Acquisition — shared types and constants.
 * ----------------------------------------------------------------------------
 * Used by BOTH the Worker (persistence + API) and the dashboard. Everything in
 * src/sales/*.ts (except this file's constants) is a pure function: it reads
 * stored evidence and returns advice. Nothing here contacts anyone — the
 * salesperson stays in control and sends every message personally.
 * ========================================================================== */

/* --------------------------------- stages --------------------------------- */

export const SALES_STAGES = [
  'DISCOVERED',
  'QUALIFIED',
  'RESEARCHED',
  'READY_TO_CONTACT',
  'CONTACTED',
  'FOLLOW_UP_1',
  'FOLLOW_UP_2',
  'REPLIED',
  'INTERESTED',
  'MEETING',
  'PROPOSAL',
  'NEGOTIATION',
  'WON',
  'LOST',
  'NOT_A_FIT',
  'DORMANT',
] as const;
export type SalesStage = (typeof SALES_STAGES)[number];

export const STAGE_LABEL: Record<SalesStage, string> = {
  DISCOVERED: 'Discovered',
  QUALIFIED: 'Qualified',
  RESEARCHED: 'Researched',
  READY_TO_CONTACT: 'Ready to contact',
  CONTACTED: 'Contacted',
  FOLLOW_UP_1: 'Follow-up 1',
  FOLLOW_UP_2: 'Follow-up 2',
  REPLIED: 'Replied',
  INTERESTED: 'Interested',
  MEETING: 'Meeting',
  PROPOSAL: 'Proposal',
  NEGOTIATION: 'Negotiation',
  WON: 'Won',
  LOST: 'Lost',
  NOT_A_FIT: 'Not a fit',
  DORMANT: 'Dormant',
};

/** Stages where the lead is still being worked. */
export const ACTIVE_STAGES: SalesStage[] = [
  'QUALIFIED', 'RESEARCHED', 'READY_TO_CONTACT', 'CONTACTED', 'FOLLOW_UP_1', 'FOLLOW_UP_2',
  'REPLIED', 'INTERESTED', 'MEETING', 'PROPOSAL', 'NEGOTIATION',
];
/** Stages where we are waiting for the prospect to answer. */
export const AWAITING_REPLY_STAGES: SalesStage[] = ['CONTACTED', 'FOLLOW_UP_1', 'FOLLOW_UP_2'];
export const CLOSED_STAGES: SalesStage[] = ['WON', 'LOST', 'NOT_A_FIT'];
/** The main funnel order used for conversion analytics. */
export const FUNNEL_ORDER: SalesStage[] = [
  'DISCOVERED', 'QUALIFIED', 'CONTACTED', 'REPLIED', 'INTERESTED', 'MEETING', 'PROPOSAL', 'WON',
];

/** What each stage maps to in the older prospects.status column, so the
 *  existing CRM screens stay consistent. DORMANT deliberately maps to nothing. */
export const LEGACY_STATUS_FOR_STAGE: Partial<Record<SalesStage, string>> = {
  DISCOVERED: 'DISCOVERED',
  QUALIFIED: 'QUALIFIED',
  RESEARCHED: 'QUALIFIED',
  READY_TO_CONTACT: 'QUALIFIED',
  CONTACTED: 'CONTACTED',
  FOLLOW_UP_1: 'FOLLOW_UP',
  FOLLOW_UP_2: 'FOLLOW_UP',
  REPLIED: 'REPLIED',
  INTERESTED: 'INTERESTED',
  MEETING: 'INTERESTED',
  PROPOSAL: 'PROPOSAL_SENT',
  NEGOTIATION: 'NEGOTIATING',
  WON: 'WON',
  LOST: 'LOST',
  NOT_A_FIT: 'NOT_INTERESTED',
};

/** How an existing prospects.status seeds the sales stage on first import. */
export const STAGE_FOR_LEGACY_STATUS: Record<string, SalesStage> = {
  DISCOVERED: 'DISCOVERED',
  QUALIFIED: 'QUALIFIED',
  CONTACTED: 'CONTACTED',
  FOLLOW_UP: 'FOLLOW_UP_1',
  REPLIED: 'REPLIED',
  INTERESTED: 'INTERESTED',
  PROPOSAL_SENT: 'PROPOSAL',
  NEGOTIATING: 'NEGOTIATION',
  WON: 'WON',
  LOST: 'LOST',
  NOT_INTERESTED: 'LOST',
};

export const LOST_REASONS = [
  'PRICE_TOO_HIGH', 'NOT_INTERESTED', 'ALREADY_HAS_WEBSITE', 'ALREADY_HAS_PROVIDER', 'NO_BUDGET',
  'NO_RESPONSE', 'TIMING', 'NOT_DECISION_MAKER', 'BAD_CONTACT', 'NOT_A_FIT', 'OTHER',
] as const;
export type LostReason = (typeof LOST_REASONS)[number];

/* ------------------------------ fact tagging ------------------------------ */

/** Nothing the AI concludes may be shown as a fact. Every statement in a brief
 *  carries one of these tags. */
export type FactKind = 'VERIFIED' | 'INFERENCE' | 'UNKNOWN';
export interface Fact {
  kind: FactKind;
  text: string;
  /** Where a VERIFIED fact comes from (stored field / audit / operator entry). */
  source?: string;
}

/* -------------------------------- channels -------------------------------- */

export const SALES_CHANNELS = [
  'WHATSAPP', 'PHONE_CALL', 'FACEBOOK_MESSENGER', 'INSTAGRAM_DM', 'EMAIL', 'WEBSITE_FORM', 'PHYSICAL_VISIT',
] as const;
export type SalesChannel = (typeof SALES_CHANNELS)[number];

export const CHANNEL_LABEL: Record<SalesChannel, string> = {
  WHATSAPP: 'WhatsApp',
  PHONE_CALL: 'Phone call',
  FACEBOOK_MESSENGER: 'Facebook Messenger',
  INSTAGRAM_DM: 'Instagram DM',
  EMAIL: 'Email',
  WEBSITE_FORM: 'Website contact form',
  PHYSICAL_VISIT: 'Physical visit',
};

export interface ChannelOption {
  channel: SalesChannel;
  reason: string;
  /** The number / URL / address to use, when we have one. */
  target?: string;
  /** Whether the contact detail itself was independently verified. */
  targetVerified: boolean;
}

export interface ChannelRecommendation {
  status: 'RECOMMENDED' | 'NO_DIRECT_CHANNEL';
  channel?: SalesChannel;
  reason: string;
  target?: string;
  targetVerified?: boolean;
  fallbacks: ChannelOption[];
  warnings: string[];
  nextStep?: string;
}

/* --------------------------------- angles --------------------------------- */

export const SALES_ANGLES = [
  'NO_WEBSITE', // A
  'OUTDATED_WEBSITE', // B
  'POOR_MOBILE', // C
  'WEAK_SEARCH_PRESENCE', // D
  'SOCIAL_NO_CENTRAL_SITE', // E
  'NO_ENQUIRY_OR_BOOKING', // F
  'NO_SERVICE_CATALOGUE', // G
  'POOR_CONVERSION_PATH', // H
  'ESTABLISHED_WEAK_DIGITAL', // I
  'IMPROVABLE_WEBSITE', // J
  'AUTOMATION_OPPORTUNITY', // K
  'CONVERSATION_FIRST', // not enough evidence for any of A–K
] as const;
export type SalesAngle = (typeof SALES_ANGLES)[number];

export const ANGLE_LETTER: Record<SalesAngle, string> = {
  NO_WEBSITE: 'A', OUTDATED_WEBSITE: 'B', POOR_MOBILE: 'C', WEAK_SEARCH_PRESENCE: 'D',
  SOCIAL_NO_CENTRAL_SITE: 'E', NO_ENQUIRY_OR_BOOKING: 'F', NO_SERVICE_CATALOGUE: 'G',
  POOR_CONVERSION_PATH: 'H', ESTABLISHED_WEAK_DIGITAL: 'I', IMPROVABLE_WEBSITE: 'J',
  AUTOMATION_OPPORTUNITY: 'K', CONVERSATION_FIRST: '—',
};

export const ANGLE_LABEL: Record<SalesAngle, string> = {
  NO_WEBSITE: 'No website',
  OUTDATED_WEBSITE: 'Outdated website',
  POOR_MOBILE: 'Poor mobile experience',
  WEAK_SEARCH_PRESENCE: 'Weak Google/search presence',
  SOCIAL_NO_CENTRAL_SITE: 'Strong social, no central website',
  NO_ENQUIRY_OR_BOOKING: 'No online booking/enquiry',
  NO_SERVICE_CATALOGUE: 'No clear service/product catalogue',
  POOR_CONVERSION_PATH: 'Poor customer conversion path',
  ESTABLISHED_WEAK_DIGITAL: 'Established but weak digital infrastructure',
  IMPROVABLE_WEBSITE: 'Existing website could be improved',
  AUTOMATION_OPPORTUNITY: 'Automation / management system opportunity',
  CONVERSATION_FIRST: 'Not enough evidence — start with a conversation',
};

/* --------------------------------- offers --------------------------------- */

export const OFFER_TYPES = [
  'WEBSITE', 'BUSINESS_WEBSITE', 'WEBSITE_ADMIN_PANEL', 'BOOKING_SYSTEM', 'ORDERING_SYSTEM',
  'DIGITAL_CATALOGUE', 'BUSINESS_AUTOMATION', 'WEBSITE_MAINTENANCE', 'CUSTOM_BUSINESS_SYSTEM',
] as const;
export type OfferType = (typeof OFFER_TYPES)[number];

export const OFFER_LABEL: Record<OfferType, string> = {
  WEBSITE: 'Simple website',
  BUSINESS_WEBSITE: 'Business website',
  WEBSITE_ADMIN_PANEL: 'Website + admin panel',
  BOOKING_SYSTEM: 'Booking system',
  ORDERING_SYSTEM: 'Ordering system',
  DIGITAL_CATALOGUE: 'Digital catalogue',
  BUSINESS_AUTOMATION: 'Business automation',
  WEBSITE_MAINTENANCE: 'Website maintenance',
  CUSTOM_BUSINESS_SYSTEM: 'Custom business system',
};

/* --------------------------------- pricing -------------------------------- */

export const PRICING_KEYS = [
  'base_website_price', 'admin_panel_addon', 'booking_addon', 'ordering_addon',
  'maintenance_monthly', 'domain_cost', 'hosting_cost', 'custom_system_price',
] as const;
export type PricingKey = (typeof PRICING_KEYS)[number];

/** null = not set → any quote that needs it becomes MANUAL_REVIEW_REQUIRED. */
export type PricingSettings = Record<PricingKey, number | null>;

export interface QuoteLine {
  key: PricingKey;
  label: string;
  amount: number | null;
  recurring: 'ONCE' | 'MONTHLY' | 'YEARLY';
  optional: boolean;
}
export interface PriceQuote {
  priceStatus: 'PRICED' | 'MANUAL_REVIEW_REQUIRED';
  lines: QuoteLine[];
  /** Sum of the required once-off lines whose price is known. */
  oneOffTotal: number;
  monthlyTotal: number;
  /** Pricing keys that were needed but not configured. */
  missing: PricingKey[];
  note: string;
}

export interface OfferRecommendation {
  offer: OfferType;
  whyThisOffer: string;
  problemSolved: string;
  necessaryFeatures: string[];
  optionalFeatures: string[];
  /** Cheaper alternative if the prospect balks — never automatically the expensive option. */
  lighterAlternative?: OfferType;
  quote: PriceQuote;
}

/* ---------------------------------- demo ---------------------------------- */

export interface DemoRecommendation {
  recommended: boolean;
  reason: string;
  suggestedDemo?: string;
  suggestedSections: string[];
}

/* ------------------------------- sales brief ------------------------------ */

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface SalesBrief {
  business: string;
  category: string;
  location: string;
  opportunity: string;
  angle: SalesAngle;
  angleReason: string;
  secondaryAngles: SalesAngle[];
  evidence: Fact[];
  decisionMaker: Fact;
  channel: ChannelRecommendation;
  approach: string;
  offer: OfferRecommendation;
  demo: DemoRecommendation;
  whyThisBusiness: string;
  confidence: Confidence;
  confidenceReasons: string[];
  /** True only when the stored evidence is strong enough to tell the business
   *  (in first person, "I couldn't find…") that it has no website. */
  websiteClaimAllowed: boolean;
  qualification: QualificationResult;
  generatedAt: number;
}

export interface QualificationResult {
  qualified: boolean;
  reasons: string[];
  blockers: string[];
}

/* ------------------------------- persistence ------------------------------ */

export type DemoStatus = 'NONE' | 'RECOMMENDED' | 'BUILT' | 'SENT';

export interface SalesLeadRow {
  prospectId: string;
  stage: SalesStage;
  stageEnteredAt: number;
  paused: boolean;
  contactPerson?: string;
  phone?: string;
  whatsapp?: string;
  email?: string;
  angle?: SalesAngle;
  recommendedChannel?: SalesChannel;
  offerType?: OfferType;
  demoStatus: DemoStatus;
  demoSentAt?: number;
  selectedMessageId?: string;
  lastContactAt?: number;
  nextAction?: string;
  nextActionAt?: number;
  lostReason?: LostReason;
  lostNotes?: string;
  wonValue?: number;
  wonAt?: number;
  briefJson?: SalesBrief;
  researchedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type ActivityKind =
  | 'LEAD_DISCOVERED' | 'LEAD_IMPORTED' | 'QUALIFIED' | 'RESEARCH_COMPLETED' | 'MESSAGE_GENERATED'
  | 'MESSAGE_SELECTED' | 'MESSAGE_SENT' | 'FOLLOW_UP_GENERATED' | 'FOLLOW_UP_SCHEDULED' | 'FOLLOW_UP_DONE'
  | 'STAGE_CHANGE' | 'REPLY_RECEIVED' | 'CALL' | 'MEETING_BOOKED' | 'MEETING_DONE' | 'DEMO_SENT'
  | 'PROPOSAL_CREATED' | 'PROPOSAL_SENT' | 'PROPOSAL_ACCEPTED' | 'PROPOSAL_REJECTED' | 'NOTE'
  | 'LEAD_UPDATED' | 'PAUSED' | 'RESUMED' | 'WON' | 'LOST' | 'DORMANT' | 'PRICING_CHANGED';

export interface SalesActivity {
  id: string;
  prospectId: string;
  kind: ActivityKind;
  summary: string;
  createdAt: number;
}

export type MessageKind = 'FIRST_CONTACT' | 'FOLLOW_UP';
export type MessageVariantKey = 'DIRECT' | 'CONSULTATIVE' | 'DEMO_LED';
export type MessageStatus = 'DRAFT' | 'SELECTED' | 'SENT';

export interface SalesMessage {
  id: string;
  prospectId: string;
  kind: MessageKind;
  /** DIRECT / CONSULTATIVE / DEMO_LED for first contact; the situation for follow-ups. */
  variant: string;
  channel?: SalesChannel;
  angle?: SalesAngle;
  body: string;
  editedBody?: string;
  status: MessageStatus;
  sentAt?: number;
  createdAt: number;
}

export interface FollowUpRow {
  id: string;
  prospectId: string;
  dueAt: number;
  kind: string;
  note: string;
  status: 'PENDING' | 'DONE' | 'SKIPPED';
  createdAt: number;
  doneAt?: number;
}

export interface MeetingRow {
  id: string;
  prospectId: string;
  scheduledAt: number;
  kind: 'CALL' | 'VIDEO' | 'VISIT';
  notes: string;
  status: 'SCHEDULED' | 'DONE' | 'CANCELLED';
  createdAt: number;
}

export interface ProposalRow {
  id: string;
  prospectId: string;
  offerType: OfferType;
  quote: PriceQuote;
  scope: string[];
  body: string;
  status: 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED';
  sentAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SalesNote {
  id: string;
  prospectId: string;
  body: string;
  createdAt: number;
}

/* -------------------------------- settings -------------------------------- */

export interface CompanyProfile {
  senderName: string;
  company: string;
  companyLine: string;
  website: string;
  phone: string;
  proofSites: string[];
  /** What the company sells — shown in messages. Keep to things that are true. */
  services: string[];
  /** Home town, used for the physical-visit channel. */
  homeTown: string;
  /** One sentence used in outreach: who we help and how. */
  valueLine: string;
  /** Shown in proposals. Leave empty to omit. */
  paymentTerms: string;
}

export interface CadenceSettings {
  /** Days after first contact before follow-up 1. */
  followUp1Days: number;
  /** Days after follow-up 1 before follow-up 2. */
  followUp2Days: number;
  /** Days after follow-up 2 with no reply before the lead goes DORMANT. */
  dormantAfterDays: number;
  /** Days after a proposal is sent before chasing it. */
  proposalChaseDays: number;
  /** Days after a demo is sent before asking for feedback. */
  demoFeedbackDays: number;
}

export interface SalesSettings {
  company: CompanyProfile;
  cadence: CadenceSettings;
}

/* --------------------------------- actions -------------------------------- */

export type ActionKind =
  | 'RESEARCH' | 'SEND_FIRST_MESSAGE' | 'FOLLOW_UP' | 'REPLY_TO_PROSPECT' | 'PREPARE_CALL'
  | 'CHASE_PROPOSAL' | 'DEMO_FEEDBACK' | 'MANUAL_RESEARCH' | 'CREATE_PROPOSAL' | 'REVIEW_DORMANT';

export interface SalesAction {
  prospectId: string;
  businessName: string;
  stage: SalesStage;
  kind: ActionKind;
  title: string;
  reason: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  rank: number;
  dueAt?: number;
  overdue: boolean;
  channel?: SalesChannel;
  /** What the UI button should open. */
  cta: 'GENERATE_MESSAGE' | 'VIEW_MESSAGE' | 'FOLLOW_UP' | 'PREPARE_CALL' | 'OPEN_LEAD' | 'RESEARCH';
}
