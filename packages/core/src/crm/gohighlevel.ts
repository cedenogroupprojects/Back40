// GoHighLevel adapter (works for white-label GoHighLevel CRMs like Jtek).
// Docs: https://highlevel.stoplight.io — base https://services.leadconnectorhq.com,
// OAuth bearer token per sub-account (locationId), header Version: 2021-07-28.
// GHL has no single "stage" on a contact (stages live on opportunities), so
// Back 40 maps stage to a tag prefix "b40:" until a team picks a pipeline.

import { crmFetch, OUTCOME_TEXT, type CrmAdapter, type CrmCredentials, type CrmEvent, type CrmLeadInput } from './adapter.ts';

const BASE = 'https://services.leadconnectorhq.com';

function headers(c: CrmCredentials): Record<string, string> {
  return { Authorization: `Bearer ${c.accessToken}`, Version: '2021-07-28', 'Content-Type': 'application/json', Accept: 'application/json' };
}

type GhlContact = {
  id: string;
  firstName?: string;
  lastName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  source?: string;
  tags?: string[];
  dateAdded?: string;
  dateUpdated?: string;
  lastActivity?: string | number;
  assignedTo?: string | null;
  dnd?: boolean;
  opportunities?: { id: string; pipeline_id?: string; pipeline_stage_id?: string; status?: string }[];
};

// Pipeline stage id → stage name, per sub-account. Fetched once per run.
const stageCache = new Map<string, Promise<Map<string, string>>>();
function stageNames(c: CrmCredentials): Promise<Map<string, string>> {
  const key = c.accountId ?? '';
  if (!stageCache.has(key)) {
    stageCache.set(
      key,
      (async () => {
        const res = (await crmFetch(`${BASE}/opportunities/pipelines?locationId=${encodeURIComponent(key)}`, { headers: headers(c) }).catch(() => null)) as {
          pipelines?: { stages?: { id: string; name: string }[] }[];
        } | null;
        const m = new Map<string, string>();
        for (const p of res?.pipelines ?? []) for (const st of p.stages ?? []) m.set(st.id, st.name);
        return m;
      })(),
    );
  }
  return stageCache.get(key)!;
}

function iso(v: string | number | undefined | null): string | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function mapGhlContact(x: GhlContact, stages: Map<string, string> = new Map()): CrmLeadInput {
  const tags = x.tags ?? [];
  // A contact's stage is its open opportunity's pipeline stage; else a Back 40 tag; else new.
  const opp = (x.opportunities ?? []).find((o) => !o.status || o.status === 'open') ?? x.opportunities?.[0];
  const oppStage = opp?.pipeline_stage_id ? stages.get(opp.pipeline_stage_id) : undefined;
  const stageTag = tags.find((t) => t.startsWith('b40:'));
  const [first = '', ...rest] = (x.contactName ?? '').split(' ');
  return {
    crm: 'gohighlevel',
    crmLeadId: x.id,
    assignedUserId: x.assignedTo ?? null,
    firstName: x.firstName ?? first,
    lastName: x.lastName ?? rest.join(' '),
    phone: x.phone,
    email: x.email,
    stage: oppStage ?? (stageTag ? stageTag.slice(4) : 'New Lead'),
    source: x.source,
    tags: tags.filter((t) => !t.startsWith('b40:')),
    createdAt: iso(x.dateAdded) ?? new Date().toISOString(),
    lastContactAt: iso(x.lastActivity),
    nextFollowUpAt: null,
    signals: [],
    fields: x.dnd ? { doNotCall: true, doNotText: true, doNotEmail: true } : {},
  };
}

async function search(c: CrmCredentials, body: Record<string, unknown>) {
  return (await crmFetch(`${BASE}/contacts/search`, {
    method: 'POST',
    headers: headers(c),
    body: JSON.stringify({ locationId: c.accountId, ...body }),
  })) as { contacts?: (GhlContact & { searchAfter?: unknown[] })[] } | null;
}

/** Sub-account users, to match a Back 40 member to their GoHighLevel user by email. */
export async function ghlUsers(c: CrmCredentials): Promise<{ id: string; email?: string; name?: string }[]> {
  const res = (await crmFetch(`${BASE}/users/?locationId=${encodeURIComponent(c.accountId ?? '')}`, { headers: headers(c) })) as {
    users?: { id: string; email?: string; name?: string }[];
  } | null;
  return res?.users ?? [];
}

export const goHighLevel: CrmAdapter = {
  kind: 'gohighlevel',
  // Private Integration tokens can't receive webhooks, so Back 40 polls GoHighLevel for changes.
  capabilities: { sendText: true, sendEmail: true, logCall: true, webhooks: false, maxRequestsPerMinute: 100 },

  // POST /contacts/search (GET /contacts is deprecated). Newest-changed first, cursor = searchAfter.
  async listLeads(c, cursor, opts) {
    const limit = 100;
    const filters = opts?.updatedSince ? [{ field: 'dateUpdated', operator: 'range', value: { gte: opts.updatedSince } }] : undefined;
    const res = await search(c, {
      pageLimit: limit,
      searchAfter: cursor ? JSON.parse(cursor) : [],
      sort: [{ field: 'dateUpdated', direction: 'desc' }],
      ...(opts?.assignedTo ? { assignedTo: opts.assignedTo } : {}),
      ...(filters ? { filters } : {}),
    });
    const raw = res?.contacts ?? [];
    const stages = await stageNames(c);
    const items = raw.map((x) => mapGhlContact(x, stages));
    const last = raw[raw.length - 1]?.searchAfter;
    return { items, nextCursor: raw.length === limit && last ? JSON.stringify(last) : null };
  },

  async getLead(c, id) {
    const res = await search(c, { pageLimit: 1, filters: [{ field: 'id', operator: 'eq', value: id }] });
    const x = res?.contacts?.[0];
    return x ? mapGhlContact(x, await stageNames(c)) : null;
  },

  async listNotes(c, id) {
    const res = (await crmFetch(`${BASE}/contacts/${id}/notes`, { headers: headers(c) })) as { notes?: { id: string; body?: string; dateAdded?: string }[] } | null;
    return (res?.notes ?? [])
      .filter((n) => n.body?.trim())
      .map((n) => ({ id: n.id, at: n.dateAdded ?? new Date().toISOString(), body: n.body!.trim() }));
  },

  async addNote(c, id, body) {
    await crmFetch(`${BASE}/contacts/${id}/notes`, { method: 'POST', headers: headers(c), body: JSON.stringify({ body }) });
  },

  async logCall(c, id, call) {
    await this.addNote(c, id, `Call — ${OUTCOME_TEXT[call.outcome]}${call.note ? `\n${call.note}` : ''} (logged by Back 40)`);
  },

  async updateLead(c, id, patch) {
    if (patch.tags || patch.stage) {
      const current = await this.getLead(c, id);
      const tags = (patch.tags ?? current?.tags ?? []).filter((t) => !t.startsWith('b40:'));
      const stage = patch.stage ?? current?.stage;
      if (stage) tags.push(`b40:${stage}`);
      await crmFetch(`${BASE}/contacts/${id}`, { method: 'PUT', headers: headers(c), body: JSON.stringify({ tags }) });
    }
  },

  async createTask(c, id, task) {
    await crmFetch(`${BASE}/contacts/${id}/tasks`, { method: 'POST', headers: headers(c), body: JSON.stringify({ title: task.title, dueDate: task.dueAt, completed: false }) });
  },

  async sendText(c, id, body) {
    await crmFetch(`${BASE}/conversations/messages`, { method: 'POST', headers: headers(c), body: JSON.stringify({ type: 'SMS', contactId: id, message: body }) });
  },

  async sendEmail(c, id, email) {
    await crmFetch(`${BASE}/conversations/messages`, { method: 'POST', headers: headers(c), body: JSON.stringify({ type: 'Email', contactId: id, subject: email.subject, html: email.body }) });
  },

  parseWebhook(body): CrmEvent[] {
    const b = (body ?? {}) as { type?: string; contactId?: string; id?: string };
    const map: Record<string, CrmEvent['kind']> = {
      ContactCreate: 'lead_created', ContactUpdate: 'lead_updated', ContactDelete: 'lead_deleted', ContactTagUpdate: 'lead_updated',
      NoteCreate: 'note', TaskCreate: 'task', InboundMessage: 'text', OutboundMessage: 'text',
    };
    const id = b.contactId ?? (b.type?.startsWith('Contact') ? b.id : undefined);
    return [{ crm: 'gohighlevel', kind: map[b.type ?? ''] ?? 'other', crmLeadIds: id ? [id] : [], raw: body }];
  },
};
