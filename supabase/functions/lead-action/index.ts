// POST /lead-action { leadId, action, clientId, ... }  (signed-in user)
//
// Every edit an agent makes in the app goes through here: the lead row and its
// timeline update right away, and the matching CRM write is queued in the
// outbox (idempotent, retried, rate-limited by the sync worker).
//
// actions:
//   stage       { stage }
//   note        { body }
//   commission  { amount, price?, rate? }   (null amount clears it)
//   follow_up   { at }                       (ISO time; creates a CRM task)
//   pin         { pinned }
//   assign      { userId }                   (team leaders only)
//   create      { lead: { firstName, lastName?, phone?, email?, stage, source?, notes? } }
//               adds a lead by hand (no leadId needed). Lives in Back 40 only.
//   message     { channel: 'text'|'email', body, subject? }
//               sends through the CRM when it can; otherwise logs what the
//               agent sent from their phone.
import { json, preflight, serviceClient, userClient, type Connection } from '../_shared/db.ts';
import { canSend } from '../_shared/sender.ts';

// Mirrors each adapter's capabilities (kept inline so this function stays small).
const CAN_SEND: Record<string, { text: boolean; email: boolean }> = {
  lofty: { text: true, email: true },
  followupboss: { text: false, email: false },
  gohighlevel: { text: true, email: true },
};

type Body = {
  leadId: string;
  action: 'stage' | 'note' | 'commission' | 'follow_up' | 'pin' | 'message' | 'assign' | 'create';
  clientId: string;
  stage?: string;
  body?: string;
  amount?: number | null;
  price?: number;
  rate?: number;
  at?: string;
  pinned?: boolean;
  channel?: 'text' | 'email';
  subject?: string;
  sentFromPhone?: boolean;
  userId?: string;
  lead?: { firstName?: string; lastName?: string; phone?: string; email?: string; stage?: string; source?: string; notes?: string };
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const b = (await req.json().catch(() => ({}))) as Body;
  if (!b.action || !b.clientId || (!b.leadId && b.action !== 'create')) return json({ error: 'missing fields' }, 400);

  // Row-level security proves this user can see the lead.
  const user = userClient(req);
  const { data: me } = await user.rpc('uid');
  if (b.action === 'create') return createLead(user, me as string | null, b);
  const { data: lead } = await user.from('leads').select('id, org_id, connection_id, crm, crm_lead_id, fields, phone').eq('id', b.leadId).maybeSingle();
  if (!me || !lead) return json({ error: 'not found' }, 404);

  const db = serviceClient();
  const now = new Date().toISOString();
  const base = { org_id: lead.org_id, connection_id: lead.connection_id, lead_id: lead.id };
  const key = (op: string) => `${b.clientId}:${op}`;
  // Hand-added leads have no CRM to write back to.
  const queue = async (op: string, payload: Record<string, unknown>) =>
    lead.crm === 'manual' || !lead.connection_id ? null : await db.from('sync_outbox').upsert({ ...base, op, idempotency_key: key(op), payload: { crmLeadId: lead.crm_lead_id, ...payload } }, { onConflict: 'idempotency_key', ignoreDuplicates: true });
  const timeline = (kind: string, title: string, body?: string) =>
    db.from('timeline_items').insert({ org_id: lead.org_id, lead_id: lead.id, at: now, kind, title, body: body ?? null, source: 'back40', crm_ref: b.clientId });

  switch (b.action) {
    case 'stage': {
      if (!b.stage) return json({ error: 'stage' }, 400);
      await db.from('leads').update({ stage: b.stage, updated_at: now }).eq('id', lead.id);
      await timeline('stage', `Stage → ${b.stage}`);
      await queue('update_lead', { patch: { stage: b.stage } });
      break;
    }
    case 'note': {
      const text = (b.body ?? '').trim();
      if (!text) return json({ error: 'body' }, 400);
      await timeline('note', 'Note', text);
      await queue('add_note', { body: text });
      break;
    }
    case 'commission': {
      const fields = { ...(lead.fields as Record<string, unknown>) };
      if (b.amount && b.amount > 0) Object.assign(fields, { potentialCommission: Math.round(b.amount), purchasePrice: b.price, commissionRate: b.rate });
      else for (const k of ['potentialCommission', 'purchasePrice', 'commissionRate']) delete fields[k];
      await db.from('leads').update({ fields, updated_at: now }).eq('id', lead.id);
      await queue('update_lead', { patch: { potentialCommission: b.amount && b.amount > 0 ? Math.round(b.amount) : null } });
      break;
    }
    case 'follow_up': {
      if (!b.at) return json({ error: 'at' }, 400);
      await db.from('leads').update({ next_follow_up_at: b.at, updated_at: now }).eq('id', lead.id);
      await queue('create_task', { task: { title: 'Follow up (Back 40)', dueAt: b.at } });
      break;
    }
    case 'pin': {
      if (b.pinned) await db.from('lead_pins').upsert({ user_id: me, lead_id: lead.id, org_id: lead.org_id });
      else await db.from('lead_pins').delete().eq('user_id', me).eq('lead_id', lead.id);
      break;
    }
    case 'message': {
      const text = (b.body ?? '').trim();
      if (!text || !b.channel) return json({ error: 'body' }, 400);
      const can = CAN_SEND[lead.crm]?.[b.channel] ?? false;
      if (can && !b.sentFromPhone) {
        // Through the CRM it goes out from the key owner's number, so only with your own key.
        const { data: conn } = await db.from('crm_connections').select('*').eq('id', lead.connection_id).maybeSingle();
        if (!conn || !(await canSend(db, conn as Connection, me))) {
          return json({ error: 'Texts from Back 40 go out from your own number, so connect your Lofty first (Me → Text from my number). Or send it from your phone.', code: 'own_number' }, 409);
        }
      }
      await db.from('leads').update({ last_contact_at: now, updated_at: now }).eq('id', lead.id);
      await timeline(b.channel, b.channel === 'text' ? 'You texted' : 'You emailed', text);
      if (can && !b.sentFromPhone) {
        await queue(b.channel === 'text' ? 'send_text' : 'send_email', b.channel === 'text' ? { body: text, sender: me } : { email: { subject: b.subject ?? '', body: text }, sender: me });
      } else {
        await queue('add_note', { body: `${b.channel === 'text' ? 'Text' : 'Email'} sent from phone (Back 40): ${text}` });
      }
      break;
    }
    case 'assign': {
      const { data: isAdmin } = await user.rpc('is_admin', { o: lead.org_id });
      if (!isAdmin || !b.userId) return json({ error: 'Only team leaders can reassign.' }, 403);
      const { data: target } = await db.from('members').select('user_id, display_name, crm_user_id').eq('org_id', lead.org_id).eq('user_id', b.userId).maybeSingle();
      if (!target) return json({ error: 'That person is not on your team.' }, 400);
      await db.from('leads').update({ assigned_user_id: target.user_id, updated_at: now }).eq('id', lead.id);
      await timeline('note', `Reassigned to ${target.display_name}`);
      if (target.crm_user_id) await queue('update_lead', { patch: { assignedUserId: target.crm_user_id } });
      break;
    }
    default:
      return json({ error: 'unknown action' }, 400);
  }
  return json({ ok: true });
});

async function createLead(user: ReturnType<typeof userClient>, me: string | null, b: Body) {
  if (!me) return json({ error: 'not signed in' }, 401);
  const l = b.lead ?? {};
  const firstName = (l.firstName ?? '').trim();
  if (!firstName) return json({ error: 'Add a first name.' }, 400);
  const { data: m } = await user.from('members').select('org_id').eq('user_id', me).limit(1).maybeSingle();
  if (!m) return json({ error: 'No team found.' }, 400);
  const db = serviceClient();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const clean = (v?: string) => (v ?? '').trim() || null;
  const { error } = await db.from('leads').insert({
    id,
    org_id: m.org_id,
    connection_id: null,
    crm: 'manual',
    crm_lead_id: id,
    assigned_user_id: me,
    first_name: firstName,
    last_name: (l.lastName ?? '').trim(),
    phone: clean(l.phone),
    email: clean(l.email)?.toLowerCase() ?? null,
    stage: clean(l.stage) ?? 'New Lead',
    source: clean(l.source) ?? 'Added in Back 40',
    crm_created_at: now,
    heat: 60,
    label: 'brand_new',
    updated_at: now,
  });
  if (error) return json({ error: error.message }, 400);
  await db.from('timeline_items').insert({ org_id: m.org_id, lead_id: id, at: now, kind: 'note', title: 'Added in Back 40', body: clean(l.notes), source: 'back40', crm_ref: b.clientId });
  return json({ ok: true, id });
}
