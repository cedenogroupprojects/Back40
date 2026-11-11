// Back 40 core types.
// One standard "lead card" that every CRM adapter maps into. The app, the
// AI pipeline and the database all speak this shape, never a CRM's own shape.

export type CrmKind = 'lofty' | 'followupboss' | 'gohighlevel';
/** Where a lead lives: a CRM, or 'manual' when it was added by hand in Back 40. */
export type LeadSourceKind = CrmKind | 'manual';

export type Role = 'owner' | 'admin' | 'agent';

export type CallOutcome = 'talked' | 'voicemail' | 'no_answer' | 'attempted';

export type LeadLabel =
  | 'brand_new'
  | 'hot_now'
  | 'promised'
  | 'follow_up'
  | 'slipping'
  | 'back_again'
  | 'pinned'
  | 'working'; // in a hot stage and recently worked: nothing urgent

export interface ActivitySignal {
  kind: 'listing_view' | 'site_visit' | 'email_open' | 'email_reply' | 'text_reply' | 'search';
  at: string; // ISO time
  detail?: string;
}

export interface TimelineItem {
  id: string;
  at: string; // ISO time
  kind: 'call' | 'note' | 'text' | 'email' | 'stage' | 'activity' | 'created' | 'task';
  title: string;
  body?: string;
  source: 'back40' | 'crm';
  outcome?: CallOutcome;
}

export interface Lead {
  id: string; // Back 40 id
  orgId: string;
  crm: LeadSourceKind;
  crmLeadId: string; // id inside the CRM (its own id for hand-added leads)
  assignedUserId: string | null;
  firstName: string;
  lastName: string;
  phone?: string;
  email?: string;
  stage: string; // the CRM's own stage name
  source?: string;
  tags: string[];
  createdAt: string;
  lastContactAt: string | null; // last call/text/email by the agent
  nextFollowUpAt: string | null; // due date of the next follow-up task
  promiseNote?: string; // e.g. "Call back Saturday"
  signals: ActivitySignal[]; // recent behaviour pulled from the CRM
  fields: LeadFields;
  pinned: boolean;
  touches: number;
  timeline: TimelineItem[];
  aiSummary?: string;
  aiWhyNow?: string;
  aiOpener?: string;
}

export interface LeadFields {
  budgetMax?: number;
  budgetMin?: number;
  bedsMin?: number;
  downPayment?: number;
  timeline?: string;
  beds?: number;
  areas?: string[];
  preApproved?: boolean;
  /** What the agent expects to earn if this one closes. Entered by the agent. */
  potentialCommission?: number;
  /** What the agent used to work it out: price × rate. */
  purchasePrice?: number;
  commissionRate?: number; // percent, e.g. 2.5
  /** From the CRM: its own 0–100 lead score, and contact restrictions. */
  crmScore?: number;
  doNotCall?: boolean;
  doNotText?: boolean;
  doNotEmail?: boolean;
  /** The CRM has recorded consent to text this lead. */
  textConsent?: boolean;
  /** When Back 40 last read the agent's notes for area/budget/beds (notes newer than this get re-read). */
  notesReadAt?: string;
  /** Which version of the notes reader filled these (older versions get re-read). */
  notesReadV?: number;
  /** Must-haves from the agent's notes. A home that fails one is never sent. */
  bathsMin?: number;
  sqftMin?: number;
  lotMinSqft?: number;
  singleStory?: boolean;
  yearBuiltMin?: number;
  garageMin?: number;
  noHoa?: boolean;
  /** Features that must be in the MLS listing itself, e.g. "pool", "ADU", "RV parking". */
  mustHave?: string[];
  /** Nice-to-haves: rank homes higher, never rule one out. */
  niceToHave?: string[];
}

export interface HotRules {
  hotStages: string[]; // stages the agent/team marked hot
  goingColdDays: number; // locked: 2 for everyone
  cap: number; // locked: ~10
}

export interface RankedLead {
  lead: Lead;
  heat: number; // 0-100
  label: LeadLabel;
  reason: string; // short plain-English reason (fallback when no AI line)
}

export interface CallLog {
  leadId: string;
  outcome: CallOutcome;
  note?: string; // cleaned note
  rawTranscript?: string;
  extracted?: Partial<LeadFields>;
  followUpAt?: string | null;
  stageChange?: string | null;
  durationSec?: number;
}

export interface Draft {
  id: string;
  leadId: string;
  channel: 'text' | 'email';
  play: 'speed_to_lead' | 'no_answer' | 'back40_sweep' | 'recap' | 'ask' | 'nurture';
  body: string;
  subject?: string;
  why: string;
  status: 'pending' | 'sent' | 'skipped';
  /** The home or new-build community this message features (nurture). */
  home?: import('./nurture.ts').HomeCard | null;
  /** Up to 5 homes the agent can swap in (coming soon / new / price drop). */
  homeOptions?: import('./nurture.ts').HomeCard[] | null;
}

export interface Agent {
  id: string;
  name: string;
  initials: string;
  role: Role;
  scoreThisWeek: number;
  streakDays: number;
  staleHotLeads: number;
}
