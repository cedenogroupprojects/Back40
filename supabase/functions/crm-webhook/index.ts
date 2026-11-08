// POST /crm-webhook?c=<connection id>&s=<webhook secret>[&list=<lofty listId>]
//
// Receives CRM webhooks. Does the minimum — verify, parse, store in
// sync_inbox — and returns 200 fast, so webhook spikes from thousands of
// teams never time out. The sync worker does the real processing.
import { ADAPTERS } from '../_shared/core/index.ts';
import { json, preflight, serviceClient, type Connection } from '../_shared/db.ts';

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const url = new URL(req.url);
  const connId = url.searchParams.get('c');
  const secret = url.searchParams.get('s');
  if (!connId || !secret) return json({ error: 'missing' }, 400);

  const db = serviceClient();
  const { data: conn } = await db.from('crm_connections').select('*').eq('id', connId).maybeSingle<Connection>();
  // Constant response for unknown/invalid so the endpoint can't be probed.
  if (!conn || conn.webhook_secret !== secret || conn.status !== 'active') return json({ ok: true });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'bad json' }, 400);
  }
  const list = url.searchParams.get('list');
  if (list && body && typeof body === 'object') (body as Record<string, unknown>).listId ??= Number(list);

  const events = ADAPTERS[conn.kind].parseWebhook(body);
  const rows = events.map((e) => ({ connection_id: conn.id, crm: e.crm, kind: e.kind, crm_lead_ids: e.crmLeadIds, raw: e.raw }));
  const { error } = await db.from('sync_inbox').insert(rows);
  if (error) return json({ error: 'store' }, 500); // CRM will retry
  return json({ ok: true, queued: rows.length });
});
