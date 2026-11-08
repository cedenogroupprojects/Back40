// Follow Up Boss adapter (V2 of the rollout).
// Docs: https://docs.followupboss.com — Basic auth with the API key as the
// username, plus X-System / X-System-Key headers once Back 40 is a registered
// system. Webhooks: peopleCreated, peopleUpdated, notesCreated, callsCreated,
// textMessagesCreated, tasksCreated… (owner permission required to register).
//
// Note: FUB's /textMessages endpoint LOGS a text but does not send it, so
// sendText is off and the app falls back to the phone's Messages + a log.

import { crmFetch, OUTCOME_TEXT, type CrmAdapter, type CrmCredentials, type CrmEvent, type CrmLeadInput } from './adapter.ts';

const BASE = 'https://api.followupboss.com/v1';

function b64(s: string): string {
  // Works in Deno, browsers and Node 18+.
  return btoa(s);
}

function headers(c: CrmCredentials): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Basic ${b64(`${c.accessToken}:`)}`, 'Content-Type': 'application/json' };
  if (c.systemName) h['X-System'] = c.systemName;
  if (c.systemKey) h['X-System-Key'] = c.systemKey;
  return h;
}

type FubPerson = {
  id: number;
  firstName?: string;
  lastName?: string;
  stage?: string;
  source?: string;
  tags?: string[];
  created?: string;
  lastActivity?: string;
  assignedUserId?: number | null;
  phones?: { value: string }[];
  emails?: { value: string }[];
};

export function mapFubPerson(p: FubPerson): CrmLeadInput {
  return {
    crm: 'followupboss',
    crmLeadId: String(p.id),
    assignedUserId: p.assignedUserId != null ? String(p.assignedUserId) : null,
    firstName: p.firstName ?? '',
    lastName: p.lastName ?? '',
    phone: p.phones?.[0]?.value,
    email: p.emails?.[0]?.value,
    stage: p.stage ?? 'Lead',
    source: p.source,
    tags: p.tags ?? [],
    createdAt: p.created ?? new Date().toISOString(),
    lastContactAt: p.lastActivity ?? null,
    nextFollowUpAt: null,
    signals: [],
    fields: {},
  };
}

const OUTCOME_FUB: Record<string, string> = { talked: 'Interested', voicemail: 'Left Message', no_answer: 'No Answer', attempted: 'No Answer' };

export const followUpBoss: CrmAdapter = {
  kind: 'followupboss',
  capabilities: { sendText: false, sendEmail: false, logCall: true, webhooks: true, maxRequestsPerMinute: 120 },

  async listLeads(c, cursor, updatedSince) {
    const offset = Number(cursor ?? 0);
    const limit = 100;
    const since = updatedSince ? `&updatedAfter=${encodeURIComponent(updatedSince)}` : '';
    const res = (await crmFetch(`${BASE}/people?limit=${limit}&offset=${offset}&sort=-updated${since}`, { headers: headers(c) })) as { people?: FubPerson[] } | null;
    const items = (res?.people ?? []).map(mapFubPerson);
    return { items, nextCursor: items.length === limit ? String(offset + limit) : null };
  },

  async getLead(c, id) {
    const p = (await crmFetch(`${BASE}/people/${id}`, { headers: headers(c) })) as FubPerson | null;
    return p ? mapFubPerson(p) : null;
  },

  async addNote(c, id, body) {
    await crmFetch(`${BASE}/notes`, { method: 'POST', headers: headers(c), body: JSON.stringify({ personId: Number(id), subject: 'Back 40', body }) });
  },

  async logCall(c, id, call) {
    await crmFetch(`${BASE}/calls`, {
      method: 'POST',
      headers: headers(c),
      body: JSON.stringify({
        personId: Number(id),
        phone: call.phone,
        isIncoming: false,
        outcome: OUTCOME_FUB[call.outcome],
        duration: call.durationSec ?? 0,
        note: [OUTCOME_TEXT[call.outcome], call.note].filter(Boolean).join(' — '),
      }),
    });
  },

  async updateLead(c, id, patch) {
    const body: Record<string, unknown> = {};
    if (patch.stage) body.stage = patch.stage;
    if (patch.tags) body.tags = patch.tags;
    if (patch.assignedUserId) body.assignedUserId = Number(patch.assignedUserId);
    // Custom field "Potential Commission" → API name customPotentialCommission (owner creates it once).
    if (patch.potentialCommission !== undefined) body.customPotentialCommission = patch.potentialCommission;
    await crmFetch(`${BASE}/people/${id}`, { method: 'PUT', headers: headers(c), body: JSON.stringify(body) });
  },

  async createTask(c, id, task) {
    await crmFetch(`${BASE}/tasks`, { method: 'POST', headers: headers(c), body: JSON.stringify({ personId: Number(id), name: task.title, type: 'Call', dueDate: task.dueAt.slice(0, 10) }) });
  },

  async sendText() {
    throw new Error('Follow Up Boss API cannot send texts; use device Messages + log.');
  },

  async sendEmail() {
    throw new Error('Follow Up Boss API cannot send email; use device mail + log.');
  },

  parseWebhook(body): CrmEvent[] {
    const b = (body ?? {}) as { event?: string; resourceIds?: (number | string)[] };
    const map: Record<string, CrmEvent['kind']> = {
      peopleCreated: 'lead_created', peopleUpdated: 'lead_updated', peopleStageUpdated: 'lead_updated', peopleDeleted: 'lead_deleted',
      notesCreated: 'note', callsCreated: 'call', textMessagesCreated: 'text', emailsCreated: 'email', tasksCreated: 'task',
    };
    // FUB sends resource ids (person ids for people events; note/call ids otherwise —
    // the worker fetches the resource to find its personId).
    return [{ crm: 'followupboss', kind: map[b.event ?? ''] ?? 'other', crmLeadIds: (b.resourceIds ?? []).map(String), raw: body }];
  },
};
