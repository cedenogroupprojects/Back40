// Sync worker. Runs every minute (Supabase cron → this function), and can be
// scaled out: claim_inbox / claim_outbox use SKIP LOCKED, so many copies can
// run at once without double-processing.
//
// 1. INBOX  — CRM changed something → re-fetch those leads → upsert lead card,
//             recompute heat/label, queue AI refresh, create nudges.
// 2. OUTBOX — Back 40 changed something → write it to the CRM, throttled to
//             each CRM's rate limit, retried with backoff, never duplicated.
import { ADAPTERS, CrmError } from '../_shared/core/index.ts';
import { backoffSeconds, credentialsFor, json, preflight, serviceClient, type Connection } from '../_shared/db.ts';
import { importNotes, queueNotesImport, upsertLead } from '../_shared/sync.ts';

const BACKFILL_MAX_PAGES = 50; // first import, per agent: up to 5,000 of their most recently active leads

const db = serviceClient();

// Simple per-connection token bucket for this run.
const buckets = new Map<string, { tokens: number; at: number }>();
async function throttle(connId: string, perMinute: number) {
  const b = buckets.get(connId) ?? { tokens: perMinute, at: Date.now() };
  const now = Date.now();
  b.tokens = Math.min(perMinute, b.tokens + ((now - b.at) / 60000) * perMinute);
  b.at = now;
  if (b.tokens < 1) await new Promise((r) => setTimeout(r, ((1 - b.tokens) / perMinute) * 60000));
  b.tokens -= 1;
  buckets.set(connId, b);
}

const connCache = new Map<string, Connection>();
async function connection(id: string): Promise<Connection> {
  if (!connCache.has(id)) {
    const { data, error } = await db.from('crm_connections').select('*').eq('id', id).single<Connection>();
    if (error || !data) throw new Error(`connection ${id} missing`);
    connCache.set(id, data);
  }
  return connCache.get(id)!;
}

async function processInbox() {
  const { data: jobs } = await db.rpc('claim_inbox', { batch: 100 });
  let done = 0;
  for (const job of jobs ?? []) {
    try {
      const conn = await connection(job.connection_id);
      const adapter = ADAPTERS[conn.kind];
      const creds = await credentialsFor(db, conn);
      if (job.kind === 'backfill') {
        // First import, one page per job so a big CRM never times out.
        const raw = job.raw as { cursor?: string | null; page?: number; assignee?: string };
        await throttle(conn.id, adapter.capabilities.maxRequestsPerMinute);
        const page = await adapter.listLeads(creds, raw.cursor ?? null, { assignedTo: raw.assignee });
        for (const l of page.items) await upsertLead(db, conn, l);
        const n = (raw.page ?? 1) + 1;
        if (page.nextCursor && n <= BACKFILL_MAX_PAGES) {
          await db.from('sync_inbox').insert({ connection_id: conn.id, crm: conn.kind, kind: 'backfill', raw: { cursor: page.nextCursor, page: n, assignee: raw.assignee } });
        } else {
          // Import finished: bring over everyone's past notes so lead cards have history.
          await queueNotesImport(db, conn);
        }
        await db.from('crm_connections').update({ last_synced_at: new Date().toISOString() }).eq('id', conn.id);
        await db.from('sync_inbox').update({ processed_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        done++;
        continue;
      }
      if (job.kind === 'notes') {
        const ids = ((job.raw as { leadIds?: string[] }).leadIds ?? []).slice(0, 50);
        const { data: rows } = await db.from('leads').select('id, org_id, crm_lead_id').in('id', ids);
        for (const r of rows ?? []) {
          await throttle(conn.id, adapter.capabilities.maxRequestsPerMinute);
          await importNotes(db, r.org_id as string, r.id as string, await adapter.listNotes(creds, r.crm_lead_id as string));
        }
        await db.from('sync_inbox').update({ processed_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
        done++;
        continue;
      }
      for (const crmLeadId of job.crm_lead_ids as string[]) {
        if (job.kind === 'lead_deleted') {
          await db.from('leads').delete().eq('connection_id', conn.id).eq('crm_lead_id', crmLeadId);
          continue;
        }
        await throttle(conn.id, adapter.capabilities.maxRequestsPerMinute);
        const fresh = await adapter.getLead(creds, crmLeadId);
        // Lofty sends new leads on the lead-info list as "createdLead".
        const created = job.kind === 'lead_created' || JSON.stringify(job.raw ?? {}).includes('"createdLead"');
        const row = fresh ? await upsertLead(db, conn, fresh, created) : null;
        if (!row && created) console.log('new lead not added', crmLeadId, fresh ? `assignee ${fresh.assignedUserId ?? 'none'}, stage ${fresh.stage}` : 'not found');
        if (row && (job.kind === 'note' || job.kind === 'lead_created')) {
          await throttle(conn.id, adapter.capabilities.maxRequestsPerMinute);
          await importNotes(db, conn.org_id, row.id as string, await adapter.listNotes(creds, crmLeadId));
        }
      }
      await db.from('sync_inbox').update({ processed_at: new Date().toISOString(), last_error: null }).eq('id', job.id);
      done++;
    } catch (e) {
      await db.from('sync_inbox').update({ last_error: String(e) }).eq('id', job.id);
    }
  }
  return done;
}

async function processOutbox() {
  const { data: jobs } = await db.rpc('claim_outbox', { batch: 50 });
  let done = 0;
  for (const job of jobs ?? []) {
    try {
      const conn = await connection(job.connection_id);
      const adapter = ADAPTERS[conn.kind];
      const creds = await credentialsFor(db, conn);
      const p = job.payload as Record<string, unknown> & { crmLeadId: string };
      await throttle(conn.id, adapter.capabilities.maxRequestsPerMinute);
      switch (job.op) {
        case 'add_note': await adapter.addNote(creds, p.crmLeadId, p.body as string); break;
        case 'log_call': await adapter.logCall(creds, p.crmLeadId, p.call as never); break;
        case 'update_lead': await adapter.updateLead(creds, p.crmLeadId, p.patch as never); break;
        case 'create_task': await adapter.createTask(creds, p.crmLeadId, p.task as never); break;
        case 'send_text': await adapter.sendText(creds, p.crmLeadId, p.body as string); break;
        case 'send_email': await adapter.sendEmail(creds, p.crmLeadId, p.email as never); break;
      }
      await db.from('sync_outbox').update({ status: 'done', last_error: null }).eq('id', job.id);
      done++;
    } catch (e) {
      const retryable = !(e instanceof CrmError) || e.retryable;
      const failed = !retryable || job.attempts >= 8;
      if (e instanceof CrmError && e.status === 401) {
        await db.from('crm_connections').update({ status: 'needs_reauth' }).eq('id', job.connection_id);
      }
      await db.from('sync_outbox').update({
        status: failed ? 'failed' : 'pending',
        last_error: String(e),
        next_attempt_at: new Date(Date.now() + backoffSeconds(job.attempts) * 1000).toISOString(),
      }).eq('id', job.id);
    }
  }
  return done;
}

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  // Only the scheduler (secret kept in Vault) or the server itself may run the worker.
  const cron = req.headers.get('x-cron-secret');
  const isService = req.headers.get('Authorization') === `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`;
  if (!isService) {
    const { data: ok } = cron ? await db.rpc('cron_secret_ok', { s: cron }) : { data: false };
    if (!ok) return json({ error: 'forbidden' }, 403);
  }
  const inbox = await processInbox();
  const outbox = await processOutbox();
  return json({ inbox, outbox });
});
