// Shared by the sync worker and connect-crm: turn a CRM lead into a Back 40
// lead row (with heat + label), and create the "new lead" nudge.
import { DEFAULT_RULES, heatScore, labelFor, type CrmLeadInput, type Lead } from './core/index.ts';
import type { Connection, serviceClient } from './db.ts';

type Db = ReturnType<typeof serviceClient>;

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
  if (!assigned && onlyTeam) {
    const { data: had } = await db.from('leads').select('id').eq('connection_id', conn.id).eq('crm_lead_id', l.crmLeadId).maybeSingle();
    if (!had) return null;
  }

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
