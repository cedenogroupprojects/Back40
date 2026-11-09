// POST /connect-crm { kind, apiKey }  (signed-in team leader)
//
// 1. Checks the key actually works by reading the first page of leads.
// 2. Stores the key in Supabase Vault (never in a table, never sent back).
// 3. Saves the connection and imports the first page right away, so leads
//    show up in the app within seconds; the rest import in the background.
// 4. Subscribes to the CRM's webhooks so changes flow in live.
import { ADAPTERS, type CrmKind } from '../_shared/core/index.ts';
import { json, preflight, serviceClient, userClient, type Connection } from '../_shared/db.ts';
import { upsertLead } from '../_shared/sync.ts';

const LOFTY_LISTS = [2, 3, 6, 7, 8, 9, 10, 12]; // lead info, activity, call, email, text, note, task, pipeline change

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const { kind, apiKey, action } = (await req.json().catch(() => ({}))) as { kind?: CrmKind; apiKey?: string; action?: 'connect' | 'disconnect' };
  if (!kind || !(kind in ADAPTERS)) return json({ error: 'Pick a CRM.' }, 400);
  if (action === 'disconnect') return disconnect(req, kind);
  const key = (apiKey ?? '').trim();
  if (key.length < 10) return json({ error: 'That key looks too short. Copy the whole API key.' }, 400);

  // Who's asking, and are they a leader on their team?
  const user = userClient(req);
  const { data: me } = await user.rpc('uid');
  if (!me) return json({ error: 'Sign in first.' }, 401);
  const db = serviceClient();
  const { data: member } = await db.from('members').select('org_id, role').eq('user_id', me).limit(1).maybeSingle();
  if (!member) return json({ error: 'Set up your team first.' }, 400);
  if (member.role === 'agent') return json({ error: 'Ask your team leader to connect the CRM.' }, 403);

  // 1. Whose key is this? Leads assigned to this CRM user are yours. On a team
  //    account the key can see every agent's leads, so we only import yours here;
  //    each agent's leads import when they join and link their CRM user.
  const adapter = ADAPTERS[kind];
  const creds = { kind, accessToken: key, systemName: Deno.env.get('FUB_SYSTEM_NAME') ?? undefined, systemKey: Deno.env.get('FUB_SYSTEM_KEY') ?? undefined };
  let crmUserId: string | null = null;
  if (kind === 'lofty') {
    const res = await fetch('https://api.lofty.com/v1.0/me', { headers: { Authorization: `token ${key}`, 'X-Error-Status': 'true' } }).catch(() => null);
    if (res && (res.status === 401 || res.status === 403)) return json({ error: "Lofty didn't accept that key. Double-check it and try again." }, 400);
    const body = res?.ok ? ((await res.json().catch(() => null)) as Record<string, unknown> | null) : null;
    // memberUserId is the id leads are assigned with; `id` is a team-membership id.
    const id = body?.memberUserId ?? body?.userId;
    crmUserId = id != null ? String(id) : null;
    console.log('lofty me', res?.status, crmUserId ? 'user found' : 'no user id');
    if (!crmUserId) return json({ error: "Connected to Lofty, but couldn't tell which Lofty user this key belongs to. Try again in a minute." }, 400);
  }

  // 1b. Does the key read leads?
  let first;
  try {
    first = await adapter.listLeads(creds, null, { assignedTo: crmUserId ?? undefined });
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error('connect-crm check failed', kind, status, String(e).slice(0, 300));
    return json({ error: status === 401 || status === 403 ? `${kind === 'lofty' ? 'Lofty' : 'Your CRM'} didn't accept that key, or it's missing the "View leads" permission.` : `Couldn't reach ${kind === 'lofty' ? 'Lofty' : 'your CRM'} (${status ?? 'network'}). Try again in a minute.` }, 400);
  }
  if (crmUserId) await db.from('members').update({ crm_user_id: crmUserId }).eq('org_id', member.org_id).eq('user_id', me);

  // 2. Key → Vault.
  const { data: secretRef, error: vErr } = await db.rpc('store_crm_secret', { secret_name: `crm:${member.org_id}:${kind}`, secret: key });
  if (vErr) return json({ error: 'Could not save the key securely.' }, 500);

  // 3. Connection row (one per team per CRM).
  const { data: existing } = await db.from('crm_connections').select('*').eq('org_id', member.org_id).eq('kind', kind).maybeSingle<Connection>();
  const fields = { org_id: member.org_id, kind, scope: 'team', owner_user_id: me, secret_ref: secretRef, status: 'active' };
  const { data: conn, error: cErr } = existing
    ? await db.from('crm_connections').update(fields).eq('id', existing.id).select('*').single<Connection>()
    : await db.from('crm_connections').insert(fields).select('*').single<Connection>();
  if (cErr || !conn) return json({ error: 'Could not save the connection.' }, 500);

  let imported = 0;
  for (const l of first.items) {
    try {
      await upsertLead(db, conn, l, false, false);
      imported++;
    } catch (e) {
      console.error('import lead failed', String(e).slice(0, 200));
    }
  }
  if (first.nextCursor) await db.from('sync_inbox').insert({ connection_id: conn.id, crm: kind, kind: 'backfill', raw: { cursor: first.nextCursor, page: 2, assignee: crmUserId } });
  await db.from('crm_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);

  // 4. Live updates (best effort; the scheduled sync still runs without them).
  const hook = `${Deno.env.get('SUPABASE_URL')}/functions/v1/crm-webhook?c=${conn.id}&s=${conn.webhook_secret}`;
  let webhooks = 0;
  if (kind === 'lofty' && !existing) {
    for (const listId of LOFTY_LISTS) {
      const res = await fetch('https://api.lofty.com/v1.0/webhook', {
        method: 'POST',
        headers: { Authorization: `token ${key}`, 'Content-Type': 'application/json', 'X-Error-Status': 'true' },
        body: JSON.stringify({ listId, callbackUrl: `${hook}&list=${listId}` }),
      }).catch(() => null);
      if (res?.ok) webhooks++;
      else console.error('lofty webhook', listId, res?.status, (await res?.text().catch(() => ''))?.slice(0, 200));
    }
  }

  const { count: mine } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('connection_id', conn.id).eq('assigned_user_id', me);
  return json({ ok: true, imported, mine: mine ?? 0, matchedYou: Boolean(crmUserId), more: Boolean(first.nextCursor), webhooks });
});

// POST { action: 'disconnect', kind } — team leader only. Removes Back 40's
// webhooks from the CRM (best effort), deletes the stored key, and removes the
// connection and every lead imported through it. Nothing in the CRM is deleted.
async function disconnect(req: Request, kind: CrmKind) {
  const user = userClient(req);
  const { data: me } = await user.rpc('uid');
  if (!me) return json({ error: 'Sign in first.' }, 401);
  const db = serviceClient();
  const { data: member } = await db.from('members').select('org_id, role').eq('user_id', me).limit(1).maybeSingle();
  if (!member) return json({ error: 'No team found.' }, 400);
  if (member.role === 'agent') return json({ error: 'Only your team leader can disconnect the CRM.' }, 403);
  const { data: conn } = await db.from('crm_connections').select('*').eq('org_id', member.org_id).eq('kind', kind).maybeSingle<Connection>();
  if (!conn) return json({ ok: true, removed: 0 });

  let hooksRemoved = 0;
  if (kind === 'lofty') {
    try {
      const { data: key } = await db.rpc('read_crm_secret', { ref: conn.secret_ref });
      if (key) {
        const h = { Authorization: `token ${key}`, 'Content-Type': 'application/json', 'X-Error-Status': 'true' };
        const res = await fetch('https://api.lofty.com/v1.0/webhook', { headers: h });
        const body = res.ok ? await res.json().catch(() => null) : null;
        const found: string[] = [];
        const walk = (v: unknown) => {
          if (Array.isArray(v)) v.forEach(walk);
          else if (v && typeof v === 'object') {
            const o = v as Record<string, unknown>;
            const url = String(o.callbackUrl ?? o.url ?? '');
            const id = o.id ?? o.webhookId;
            if (url.includes(conn.id) && id != null) found.push(String(id));
            else Object.values(o).forEach(walk);
          }
        };
        walk(body);
        for (const id of found) {
          const del = await fetch(`https://api.lofty.com/v1.0/webhook/${id}`, { method: 'DELETE', headers: h }).catch(() => null);
          if (del?.ok) hooksRemoved++;
          else console.error('lofty webhook delete', id, del?.status);
        }
        console.log('lofty webhooks', res.status, 'found', found.length, 'removed', hooksRemoved);
      }
    } catch (e) {
      console.error('webhook cleanup failed', String(e).slice(0, 200));
    }
  }

  const { count } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('connection_id', conn.id);
  await db.rpc('delete_crm_secret', { secret_name: `crm:${member.org_id}:${kind}` });
  await db.from('crm_connections').delete().eq('id', conn.id);
  await db.from('members').update({ crm_user_id: null }).eq('org_id', member.org_id).eq('user_id', me);
  return json({ ok: true, removed: count ?? 0, webhooksRemoved: hooksRemoved });
}
