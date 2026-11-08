// POST /log-call — called by the app when the agent taps "Save to <CRM>".
// Writes the call log locally (instant UI), then queues every CRM write in the
// outbox with an idempotency key, so a double-tap or a retry can never create
// two notes in the agent's CRM.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { pointsFor, type CallLog } from '../_shared/core/index.ts';
import { json, preflight, serviceClient } from '../_shared/db.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const auth = req.headers.get('Authorization') ?? '';
  // User-scoped client: RLS proves the agent can see this lead.
  const userDb = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const body = (await req.json()) as CallLog & { clientId: string; speedToLead?: boolean };

  const { data: lead } = await userDb.from('leads').select('id, org_id, connection_id, crm_lead_id, phone, touches, fields').eq('id', body.leadId).maybeSingle();
  if (!lead) return json({ error: 'not found' }, 404);
  const { data: who } = await userDb.rpc('uid');
  const db = serviceClient();
  const points = pointsFor(body.outcome, body.speedToLead);

  await db.from('call_logs').insert({
    org_id: lead.org_id, lead_id: lead.id, user_id: who, outcome: body.outcome, note: body.note,
    raw_transcript: body.rawTranscript, extracted: body.extracted ?? null, follow_up_at: body.followUpAt,
    stage_change: body.stageChange, duration_sec: body.durationSec, points,
  });

  const leadPatch: Record<string, unknown> = { last_contact_at: new Date().toISOString(), next_follow_up_at: body.followUpAt ?? null };
  if (body.stageChange) leadPatch.stage = body.stageChange;
  if (body.extracted) leadPatch.fields = { ...((lead as { fields?: Record<string, unknown> }).fields ?? {}), ...body.extracted };
  await db.from('leads').update(leadPatch).eq('id', lead.id);

  const base = { org_id: lead.org_id, connection_id: lead.connection_id, lead_id: lead.id };
  const k = (op: string) => `${body.clientId}:${op}`; // same clientId = same action
  const jobs = [
    { ...base, op: 'log_call', idempotency_key: k('call'), payload: { crmLeadId: lead.crm_lead_id, call: { outcome: body.outcome, note: body.note, durationSec: body.durationSec, phone: lead.phone } } },
  ];
  if (body.followUpAt) jobs.push({ ...base, op: 'create_task', idempotency_key: k('task'), payload: { crmLeadId: lead.crm_lead_id, task: { title: 'Follow up (Back 40)', dueAt: body.followUpAt } } as never });
  if (body.stageChange) jobs.push({ ...base, op: 'update_lead', idempotency_key: k('stage'), payload: { crmLeadId: lead.crm_lead_id, patch: { stage: body.stageChange } } as never });
  if (lead.connection_id) await db.from('sync_outbox').upsert(jobs, { onConflict: 'idempotency_key', ignoreDuplicates: true }); // hand-added leads stay in Back 40

  const LABEL: Record<string, string> = { talked: 'talked', voicemail: 'left voicemail', no_answer: 'no answer', attempted: 'attempted' };
  await db.from('timeline_items').insert({ org_id: lead.org_id, lead_id: lead.id, at: new Date().toISOString(), kind: 'call', title: `You called · ${LABEL[body.outcome] ?? body.outcome}`, body: body.note ?? null, source: 'back40', outcome: body.outcome, crm_ref: body.clientId });
  await db.from('leads').update({ touches: ((lead as { touches?: number }).touches ?? 0) + 1 }).eq('id', lead.id);

  return json({ ok: true, points });
});
