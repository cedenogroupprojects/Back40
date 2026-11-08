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
  const { kind, apiKey } = (await req.json().catch(() => ({}))) as { kind?: CrmKind; apiKey?: string };
  if (!kind || !(kind in ADAPTERS)) return json({ error: 'Pick a CRM.' }, 400);
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

  // 1. Does the key work?
  const adapter = ADAPTERS[kind];
  const creds = { kind, accessToken: key, systemName: Deno.env.get('FUB_SYSTEM_NAME') ?? undefined, systemKey: Deno.env.get('FUB_SYSTEM_KEY') ?? undefined };
  let first;
  try {
    first = await adapter.listLeads(creds, null);
  } catch (e) {
    const status = (e as { status?: number }).status;
    console.error('connect-crm check failed', kind, status, String(e).slice(0, 300));
    return json({ error: status === 401 || status === 403 ? `${kind === 'lofty' ? 'Lofty' : 'Your CRM'} didn't accept that key. Double-check it and try again.` : `Couldn't reach ${kind === 'lofty' ? 'Lofty' : 'your CRM'} (${status ?? 'network'}). Try again in a minute.` }, 400);
  }

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
      await upsertLead(db, conn, l);
      imported++;
    } catch (e) {
      console.error('import lead failed', String(e).slice(0, 200));
    }
  }
  if (first.nextCursor) await db.from('sync_inbox').insert({ connection_id: conn.id, crm: kind, kind: 'backfill', raw: { cursor: first.nextCursor, page: 2 } });
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

  return json({ ok: true, imported, more: Boolean(first.nextCursor), webhooks });
});
