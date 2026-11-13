// Lofty adapter — first CRM for the pilot.
// Docs: https://developer.lofty.com (REST, OAuth 2.0 or API key).
// Base URL https://api.lofty.com. Webhooks: POST /v1.0/webhook with listId
// 1-12 (2 = lead info, 3 = lead activity, 6 = call, 8 = text, 9 = note, 10 = task).
//
// Checked against developer.lofty.com on Nov 8, 2026 (see docs/CRM-API-CHECK.md).
// Lines marked VERIFY still need a test call against a real account.
//
// Gotcha: Lofty returns HTTP 200 with an error body for many failures unless the
// request sends `X-Error-Status: true`, so every request sends it.

import { crmFetch, OUTCOME_TEXT, type CrmAdapter, type CrmCredentials, type CrmEvent, type CrmLeadInput } from './adapter.ts';

const BASE = 'https://api.lofty.com';

function headers(c: CrmCredentials): Record<string, string> {
  // OAuth tokens use "Bearer", personal API keys use "token".
  const scheme = c.accessToken.startsWith('oauth:') ? 'Bearer' : 'token';
  const token = c.accessToken.replace(/^oauth:/, '');
  return { Authorization: `${scheme} ${token}`, 'Content-Type': 'application/json', 'X-Error-Status': 'true' };
}

type LoftyLead = {
  leadId: number | string;
  firstName?: string;
  lastName?: string;
  emails?: (string | { email?: string; value?: string })[];
  phones?: (string | { phone?: string; number?: string; value?: string })[];
  stage?: string;
  source?: string;
  tags?: (string | { tagName: string })[];
  createTime?: string | number;
  lastTouch?: string;
  lastVisit?: string;
  assignedUserId?: number | null;
  assigneeId?: number | null;
  buyingTimeFrame?: string | null;
  preQual?: string | null;
  score?: number | null;
  leadInquiry?: { priceMax?: number; priceMin?: number; bedroomsMin?: number; locations?: { city?: string | null; zipCode?: string | null }[] | null } | null;
  phoneConsentStates?: string[] | null;
  city?: string | null;
  cannotCall?: boolean;
  cannotText?: boolean;
  cannotEmail?: boolean;
};

// Lofty's buyingTimeFrame codes → words an agent would say.
const TIMEFRAME: Record<string, string> = {
  '0_to_3_': '0–3 months', '3_to_6_': '3–6 months', '6_to_12_': '6–12 months', '12_plus_': '12+ months', just_looking: 'Just looking',
};

function toIso(v: string | number | undefined | null): string | null {
  if (v === undefined || v === null || v === '') return null;
  // Lofty sends "2026-11-07T01:33:38GMT", which JavaScript can't read as-is.
  const d = typeof v === 'number' ? new Date(v) : new Date(String(v).replace(/GMT$/, 'Z'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Lofty returns contact arrays as strings or small objects depending on the endpoint.
function first(list: unknown[] | undefined, keys: string[]): string | undefined {
  const v = list?.[0];
  if (typeof v === 'string') return v || undefined;
  if (v && typeof v === 'object') for (const k of keys) if (typeof (v as Record<string, unknown>)[k] === 'string') return (v as Record<string, string>)[k];
  return undefined;
}

export function mapLoftyLead(l: LoftyLead): CrmLeadInput {
  const lastVisit = toIso(l.lastVisit);
  return {
    crm: 'lofty',
    crmLeadId: String(l.leadId),
    assignedUserId: (l.assignedUserId ?? l.assigneeId) != null ? String(l.assignedUserId ?? l.assigneeId) : null,
    firstName: l.firstName ?? '',
    lastName: l.lastName ?? '',
    phone: first(l.phones, ['phone', 'number', 'value']),
    email: first(l.emails, ['email', 'value']),
    stage: l.stage ?? 'New Lead',
    source: l.source,
    tags: (l.tags ?? []).map((t) => (typeof t === 'string' ? t : t.tagName)),
    createdAt: toIso(l.createTime) ?? new Date().toISOString(),
    lastContactAt: toIso(l.lastTouch),
    nextFollowUpAt: null,
    signals: lastVisit ? [{ kind: 'site_visit', at: lastVisit }] : [],
    fields: loftyFields(l),
  };
}

function loftyFields(l: LoftyLead): CrmLeadInput['fields'] {
  const f: CrmLeadInput['fields'] = {};
  if (l.buyingTimeFrame) {
    // Lofty sends codes like "3_to_6_", "3-6" or "12+". Normalize to "3–6 months".
    const nums = l.buyingTimeFrame.match(/\d+/g);
    f.timeline = TIMEFRAME[l.buyingTimeFrame] ?? (nums?.length === 2 ? `${nums[0]}–${nums[1]} months` : nums?.length === 1 ? `${nums[0]}+ months` : l.buyingTimeFrame.replace(/_/g, ' ').trim());
  }
  if (l.preQual) f.preApproved = l.preQual.toLowerCase() === 'yes';
  if (typeof l.score === 'number') f.crmScore = l.score;
  const q = l.leadInquiry;
  if (q?.priceMax && q.priceMax > 0) f.budgetMax = q.priceMax;
  if (q?.priceMin && q.priceMin > 0) f.budgetMin = q.priceMin;
  if (q?.bedroomsMin && q.bedroomsMin > 0) f.bedsMin = q.bedroomsMin;
  const areas = [...new Set([...(q?.locations ?? []).map((x) => x.city?.trim()), l.city?.trim()].filter((x): x is string => !!x))];
  if (areas.length) f.areas = areas;
  if (l.phoneConsentStates?.some((s) => /consent/i.test(s))) f.textConsent = true;
  if (l.cannotCall) f.doNotCall = true;
  if (l.cannotText) f.doNotText = true;
  if (l.cannotEmail) f.doNotEmail = true;
  return f;
}

export const lofty: CrmAdapter = {
  kind: 'lofty',
  capabilities: { sendText: true, sendEmail: true, logCall: true, webhooks: true, maxRequestsPerMinute: 120 },

  async listLeads(c, cursor, opts) {
    const offset = Number(cursor ?? 0);
    const limit = 100;
    // assignedUserId filter verified against the live API (returns only that agent's leads).
    const who = opts?.assignedTo ? `&assignedUserId=${encodeURIComponent(opts.assignedTo)}` : '';
    const res = (await crmFetch(`${BASE}/v1.0/leads?limit=${limit}&offset=${offset}&sort=LastActivity&desc=true${who}`, {
      headers: headers(c),
    })) as { leads?: LoftyLead[] } | null;
    const items = (res?.leads ?? []).map(mapLoftyLead);
    return { items, nextCursor: items.length === limit ? String(offset + limit) : null };
  },

  async getLead(c, id) {
    const res = (await crmFetch(`${BASE}/v1.0/leads/${id}`, { headers: headers(c) })) as Record<string, unknown> | null;
    if (!res) return null;
    // The single-lead endpoint may wrap the lead ({lead}, {data}, {leads:[…]}). Unwrap, and
    // never lose the id we asked for: without it the lead can't be matched or saved.
    const inner = (res.lead ?? res.data ?? (Array.isArray(res.leads) ? res.leads[0] : null) ?? res) as LoftyLead;
    if (inner.leadId == null) console.log('lofty getLead shape', id, Object.keys(res).slice(0, 12).join(','));
    return mapLoftyLead({ ...inner, leadId: inner.leadId ?? id });
  },

  // Verified live: GET /v1.0/notes?leadId= → { notes: [{ noteId, content, createTime, creatorName, isPin, systemNote, deleteFlag }] }
  async listNotes(c, id) {
    const res = (await crmFetch(`${BASE}/v1.0/notes?leadId=${encodeURIComponent(id)}&limit=50`, { headers: headers(c) })) as
      | { notes?: { id?: number | string; noteId?: number | string; content?: string; createTime?: string; creatorName?: string; isPin?: boolean; systemNote?: boolean; deleteFlag?: boolean }[] }
      | null;
    return (res?.notes ?? [])
      .filter((n) => !n.systemNote && !n.deleteFlag && n.content?.trim())
      .map((n) => ({ id: String(n.noteId ?? n.id), at: toIso(n.createTime) ?? new Date().toISOString(), body: n.content!.trim(), author: n.creatorName, pinned: !!n.isPin }));
  },

  async addNote(c, id, body) {
    await crmFetch(`${BASE}/v1.0/notes`, { method: 'POST', headers: headers(c), body: JSON.stringify({ leadId: Number(id), content: body }) });
  },

  async logCall(c, id, call) {
    // Manual log: records a call made outside Lofty (on the agent's own phone),
    // with a real outcome, on the lead's timeline. Needs the lead's phone number.
    const outcome: Record<string, string | undefined> = { talked: 'Talked', voicemail: 'VoiceMessage', no_answer: 'NoAnswer', attempted: undefined };
    const content = `${OUTCOME_TEXT[call.outcome]}${call.note ? ` — ${call.note}` : ''} (Back 40)`;
    if (!call.phone) return this.addNote(c, id, `Call: ${content}`);
    await crmFetch(`${BASE}/v1.0/logType`, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify({ leadId: Number(id), logType: 'logCall', content, leadPhoneNumber: call.phone.slice(0, 20), callingOutcome: outcome[call.outcome], outboundOrInbound: 'outbound' }),
    });
  },

  async updateLead(c, id, patch) {
    const body: Record<string, unknown> = {};
    if (patch.stage) body.stage = patch.stage.slice(0, 19); // Lofty: stage under 20 characters
    if (patch.tags) body.tags = patch.tags;
    if (patch.assignedUserId) body.assignedUserId = Number(patch.assignedUserId);
    if (patch.potentialCommission !== undefined) {
      // VERIFY attributeType value for a number field (list via GET /v1.0/teamFeatures custom fields).
      body.customAttributeList = [{ attributeName: 'Potential Commission', attributeType: 'number', value: patch.potentialCommission ?? '' }];
    }
    await crmFetch(`${BASE}/v1.0/leads/${id}`, { method: 'PUT', headers: headers(c), body: JSON.stringify(body) });
  },

  async createTask(c, id, task) {
    // VERIFY field names on POST /v1.0/tasks.
    await crmFetch(`${BASE}/v1.0/tasks`, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify({ leadId: Number(id), content: task.title, deadline: task.dueAt, type: 'Call' }),
    });
  },

  async sendText(c, id, body) {
    // Sends from the CALLER's Lofty virtual number, so this must run with the
    // agent's own token (not the team owner's). Fails if they have no number.
    await crmFetch(`${BASE}/v1.0/message/sms/send`, { method: 'POST', headers: headers(c), body: JSON.stringify({ leadId: Number(id), content: body }) });
  },

  async sendEmail(c, id, email) {
    await crmFetch(`${BASE}/v1.0/message/email/send`, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify({ leadId: Number(id), subject: email.subject, content: email.body }),
    });
  },

  parseWebhook(body): CrmEvent[] {
    // Lofty batches events. Each subscription has a listId; we register one
    // callback URL per listId (…/lofty?list=2) so the kind is known up front.
    const b = (body ?? {}) as Record<string, unknown>;
    const list = Number(b.listId ?? b.list ?? 0);
    const kindByList: Record<number, CrmEvent['kind']> = { 2: 'lead_updated', 3: 'activity', 6: 'call', 7: 'email', 8: 'text', 9: 'note', 10: 'task' };
    const ids = new Set<string>();
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') {
        for (const [k, val] of Object.entries(v)) {
          if (k === 'leadId' && (typeof val === 'string' || typeof val === 'number')) ids.add(String(val));
          else walk(val);
        }
      }
    };
    walk(b);
    return [{ crm: 'lofty', kind: kindByList[list] ?? 'other', crmLeadIds: [...ids], raw: body }];
  },
};

// ── Listings (for nurture home matching) ──
// POST /v2.0/listings/search (needs the key/app to have Listings → View).
// The response shape isn't documented field-by-field, so this reads it defensively.
export type ListingCriteria = { cities?: string[]; priceMin?: number; priceMax?: number; bedsMin?: number; bathsMin?: number; sqftMin?: number; lotMinSqft?: number; singleStory?: boolean };

/** One listing's full MLS record (GET /v1.0/listing?listingId=, verified live Nov 11). */
export type ListingDetail = {
  listingId: string;
  status: string;
  description: string;
  interiorFeatures: string;
  exterior: string;
  hoaFee: number | null; // null = not reported
  garage: number | null;
  yearBuilt: number | null;
  lotSqft: number | null;
  photos: string[];
};

export async function loftyListingDetail(c: CrmCredentials, listingId: string): Promise<ListingDetail | null> {
  const res = await fetch(`${BASE}/v1.0/listing?listingId=${encodeURIComponent(listingId)}`, { headers: headers(c) });
  if (res.status === 401 || res.status === 403 || res.status === 404) return null;
  if (!res.ok) throw new Error(`lofty listing ${res.status}`);
  const body = (await res.json()) as { listIng?: Record<string, unknown>[] };
  const r = body?.listIng?.[0];
  if (!r) return null;
  const num = (v: unknown) => (v === null || v === undefined || v === '' || Number(v) < 0 || Number.isNaN(Number(v)) ? null : Number(v));
  let photos: string[] = [];
  const pl = r.pictureList;
  if (Array.isArray(pl)) photos = pl.filter((x): x is string => typeof x === 'string');
  else if (typeof pl === 'string') {
    try {
      const parsed = JSON.parse(pl);
      if (Array.isArray(parsed)) photos = parsed.filter((x): x is string => typeof x === 'string');
    } catch {
      /* not JSON */
    }
  }
  return {
    listingId: String(r.listingId ?? listingId),
    status: String(r.listingStatus ?? ''),
    description: String(r.detailsDescribe ?? ''),
    interiorFeatures: String(r.interiorFeatures ?? ''),
    exterior: String(r.exterior ?? ''),
    hoaFee: num(r.hoaFee),
    garage: num(r.garageParkingSpaces),
    yearBuilt: num(r.builtYear),
    lotSqft: num(r.totalAvailableAcres),
    photos,
  };
}

/**
 * The three "get it before everyone else" searches. Filters verified live
 * (Nov 10): listingStatus ["Coming Soon"], daysOnSite "0,7", priceReduced true.
 */
export const DEAL_SEARCHES = {
  coming_soon: { listingStatus: ['Coming Soon'] },
  new: { listingStatus: ['Active'], daysOnSite: '0,7' },
  price_drop: { listingStatus: ['Active'], priceReduced: true },
} as const;
export type DealKind = keyof typeof DEAL_SEARCHES;

export async function loftySearchListings(c: CrmCredentials, q: ListingCriteria, pageSize = 10, extra: Record<string, unknown> = {}): Promise<Record<string, unknown>[] | null> {
  const filterConditions: Record<string, unknown> = { ...extra };
  if (q.cities?.length) filterConditions.location = { city: q.cities };
  if (q.priceMax) filterConditions.price = `${q.priceMin ?? ''},${q.priceMax}`;
  if (q.bedsMin) filterConditions.beds = `${q.bedsMin},`;
  // Verified live Nov 11: these narrow the search. (builtYear, pool, garage and HOA are ignored, so those are checked per listing.)
  if (q.bathsMin) filterConditions.baths = `${q.bathsMin},`;
  if (q.sqftMin) filterConditions.sqft = `${q.sqftMin},`;
  if (q.lotMinSqft) filterConditions.lotSize = `${q.lotMinSqft},`;
  if (q.singleStory) filterConditions.stories = '1,1';
  const res = await fetch(`${BASE}/v2.0/listings/search`, {
    method: 'POST',
    headers: headers(c),
    body: JSON.stringify({ searchScope: 'all', soldFlag: false, filterConditions, sortFields: ['LISTING_DATE_DESC'], pageSize, pageNum: 1 }),
  });
  if (res.status === 401 || res.status === 403) return null; // no listings permission
  if (!res.ok) throw new Error(`lofty listings ${res.status}`);
  const body = await res.json();
  if (Array.isArray(body?.listing)) return body.listing as Record<string, unknown>[];
  const found: Record<string, unknown>[] = [];
  const walk = (v: unknown) => {
    if (found.length) return;
    if (Array.isArray(v) && v.length && typeof v[0] === 'object') found.push(...(v as Record<string, unknown>[]));
    else if (v && typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  };
  walk(body);
  return found;
}
