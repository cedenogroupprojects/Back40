// Shared by the sync worker and connect-crm: turn a CRM lead into a Back 40
// lead row (with heat + label), and create the "new lead" nudge.
import { DEFAULT_RULES, heatScore, labelFor, type CrmLeadInput, type CrmNote, type Lead } from './core/index.ts';
import type { Connection, serviceClient } from './db.ts';

type Db = ReturnType<typeof serviceClient>;

export { DONE_STAGE } from './core/nurture.ts';
import { DONE_STAGE } from './core/nurture.ts';

export async function upsertLead(db: Db, conn: Connection, l: CrmLeadInput, isNew = false, onlyTeam = true) {
  // CRM assignee → Back 40 user. Only leads assigned to you in the CRM land on
  // your list. Leads for agents who haven't joined Back 40 yet stay unassigned
  // (team leaders see them in Team admin) and move to the agent when they link.
  let assigned: string | null = null;
  if (l.assignedUserId) {
    const { data: member } = await db.from('members').select('user_id').eq('org_id', conn.org_id).eq('crm_user_id', l.assignedUserId).maybeSingle();
    assigned = member?.user_id ?? null;
  }
  // Big teams have tens of thousands of leads. Only keep the ones that belong to
  // someone on Back 40 (or that we already have, so a reassignment moves it off a list).
  const { data: had } = await db.from('leads').select('id, fields').eq('connection_id', conn.id).eq('crm_lead_id', l.crmLeadId).maybeSingle();
  if (!assigned && onlyTeam && !had) return null;
  // Done deals and dead leads don't belong on a hot sheet; leave them in the CRM.
  if (!had && DONE_STAGE.test(l.stage)) return null;
  // CRM facts refresh; what the agent entered in Back 40 (commission etc.) is kept.
  const fields = { ...((had?.fields as Record<string, unknown> | null) ?? {}), ...l.fields };

  const { data: settings } = await db.from('org_settings').select('hot_stages').eq('org_id', conn.org_id).maybeSingle();
  const rules = { ...DEFAULT_RULES, hotStages: settings?.hot_stages ?? DEFAULT_RULES.hotStages };
  const lead = { ...l, id: '', orgId: conn.org_id, pinned: false, timeline: [], touches: 0 } as unknown as Lead;
  const now = Date.now();
  const row = {
    org_id: conn.org_id,
    connection_id: conn.id,
    crm: conn.kind,
    crm_lead_id: l.crmLeadId,
    assigned_user_id: assigned,
    crm_assignee_id: l.assignedUserId ?? null,
    first_name: l.firstName,
    last_name: l.lastName,
    phone: l.phone ?? null,
    email: l.email ?? null,
    stage: l.stage,
    source: l.source ?? null,
    tags: l.tags,
    crm_created_at: l.createdAt,
    last_contact_at: l.lastContactAt,
    signals: l.signals,
    fields,
    heat: heatScore(lead, rules, now),
    label: labelFor(lead, rules, now),
    updated_at: new Date().toISOString(),
  };
  const { data: saved, error } = await db.from('leads').upsert(row, { onConflict: 'connection_id,crm_lead_id' }).select('id, assigned_user_id').single();
  if (error) throw new Error(`lead upsert: ${error.message}`);

  if (isNew && saved?.assigned_user_id) {
    await db.from('nudges').insert({
      org_id: conn.org_id, user_id: saved.assigned_user_id, kind: 'new_lead', lead_id: saved.id,
      title: 'New lead', body: `${l.firstName} ${l.lastName} just came in. Nobody has called yet.`,
    });
  }
  return saved;
}

/** Copy the lead's existing CRM notes onto its Back 40 timeline (deduped by note id). */
export async function importNotes(db: Db, orgId: string, leadId: string, notes: CrmNote[]) {
  if (!notes.length) return 0;
  const rows = notes.map((n) => ({
    org_id: orgId,
    lead_id: leadId,
    at: n.at,
    kind: 'note',
    title: n.author ? `Note · ${n.author}` : 'Note',
    body: n.body.slice(0, 4000),
    source: 'crm',
    crm_ref: `note:${n.id}`,
  }));
  const { error } = await db.from('timeline_items').upsert(rows, { onConflict: 'lead_id,source,crm_ref' });
  if (error) throw new Error(`notes upsert: ${error.message}`);
  return rows.length;
}

/** Queue a notes import for this connection's active leads, 25 per job. */
export async function queueNotesImport(db: Db, conn: Connection) {
  const { data } = await db.from('leads').select('id, stage').eq('connection_id', conn.id).not('assigned_user_id', 'is', null).limit(10000);
  const ids = (data ?? []).filter((l) => !DONE_STAGE.test(l.stage as string)).map((l) => l.id as string);
  for (let i = 0; i < ids.length; i += 25) {
    await db.from('sync_inbox').insert({ connection_id: conn.id, crm: conn.kind, kind: 'notes', raw: { leadIds: ids.slice(i, i + 25) } });
  }
  return ids.length;
}
