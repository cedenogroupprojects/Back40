// POST /nurture
//
// Cron (x-cron-secret, every 15 min): for each agent with nurture on, once per
// local morning (from 6 AM in the team's time zone):
//   1. enrolls leads that aren't on Today into the sequence (first touches spread
//      over two weeks),
//   2. picks today's due leads (up to the agent's daily limit),
//   3. finds a home (MLS listing via their CRM) or a new-build community that fits,
//   4. writes a short, personal message in the agent's voice,
//   5. approve mode: drafts wait in "Ready for you"; auto mode: queued to send
//      through the CRM during daytime hours.
//
// Signed-in user, body { preview: true, limit?: number }: runs the same steps for
// that agent right now (the "Get today's messages now" button / first run).
import {
  DONE_STAGE, firstTouchAt, loftySearchListings, nextTouchAt, nurtureEligible, nurturePrompt, pickChannel, touchKind,
  type CrmKind, type HomeCard, type LeadFields,
} from '../_shared/core/index.ts';
import { credentialsFor, json, preflight, serviceClient, userClient, type Connection } from '../_shared/db.ts';

const MODEL = Deno.env.get('AI_MODEL_SMART') ?? 'claude-sonnet-5-5';
const CAN_SEND: Record<string, boolean> = { lofty: true, gohighlevel: true }; // Follow Up Boss can't send through its API
const db = serviceClient();

type Settings = { org_id: string; user_id: string; enabled: boolean; mode: 'approve' | 'auto'; daily_limit: number; channels: ('text' | 'email')[]; website_url: string | null; last_run_on: string | null };
type LeadRow = {
  id: string; org_id: string; connection_id: string | null; crm: CrmKind | 'manual'; crm_lead_id: string; first_name: string; last_name: string;
  phone: string | null; email: string | null; stage: string; source: string | null; crm_created_at: string; last_contact_at: string | null; fields: LeadFields;
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = (await req.json().catch(() => ({}))) as { preview?: boolean; limit?: number };

  // Who's calling: the scheduler, or an agent asking for their batch now.
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    const { data: ok } = await db.rpc('cron_secret_ok', { s: secret });
    if (!ok) return json({ error: 'forbidden' }, 403);
    const { data: all } = await db.from('nurture_settings').select('*').eq('enabled', true);
    const results = [];
    for (const s of (all ?? []) as Settings[]) {
      try {
        results.push(await runFor(s, { force: false }));
      } catch (e) {
        console.error('nurture run failed', s.user_id, String(e).slice(0, 300));
      }
    }
    // Auto mode: send anything whose time has come.
    await sendDueAuto();
    return json({ ok: true, ran: results.filter((r) => r.ran).length });
  }

  const user = userClient(req);
  const { data: me } = await user.rpc('uid');
  if (!me) return json({ error: 'Sign in first.' }, 401);
  const { data: member } = await db.from('members').select('org_id').eq('user_id', me).limit(1).maybeSingle();
  if (!member) return json({ error: 'No team found.' }, 400);
  let { data: s } = await db.from('nurture_settings').select('*').eq('org_id', member.org_id).eq('user_id', me).maybeSingle<Settings>();
  if (!s) {
    const { data: created } = await db.from('nurture_settings').insert({ org_id: member.org_id, user_id: me, enabled: true }).select('*').single<Settings>();
    s = created!;
  }
  const r = await runFor(s, { force: true, limit: Math.min(body.limit ?? s.daily_limit, 25) });
  return json({ ok: true, ...r });
});

async function runFor(s: Settings, opts: { force: boolean; limit?: number }) {
  const { data: org } = await db.from('org_settings').select('timezone, quiet_start, quiet_end').eq('org_id', s.org_id).maybeSingle();
  const tz = (org?.timezone as string) ?? 'America/Los_Angeles';
  const local = localParts(tz);
  if (!opts.force && (local.hour < 6 || s.last_run_on === local.date)) return { ran: false, drafted: 0 };

  if (!planAllows(s)) return { ran: false, drafted: 0 };
  await enroll(s);
  const drafted = await draftDue(s, opts.limit ?? s.daily_limit, tz, org?.quiet_end as string | undefined);
  await db.from('nurture_settings').update({ last_run_on: local.date, updated_at: new Date().toISOString() }).eq('org_id', s.org_id).eq('user_id', s.user_id);
  return { ran: true, drafted };
}

// Placeholder hook for plan/billing checks later (seats, AI limits). Everyone on for now.
function planAllows(_s: Settings) {
  return true;
}

/** Put this agent's leads into the sequence the first time we see them. */
async function enroll(s: Settings) {
  const { data: leads } = await db
    .from('leads')
    .select('id, crm_created_at, last_contact_at, fields, connection_id, crm, phone, email')
    .eq('org_id', s.org_id)
    .eq('assigned_user_id', s.user_id)
    .not('connection_id', 'is', null)
    .limit(5000);
  const { data: existing } = await db.from('nurture_state').select('lead_id').eq('user_id', s.user_id).limit(10000);
  const have = new Set((existing ?? []).map((r) => r.lead_id as string));
  const now = Date.now();
  // Best leads first: higher CRM score, then most recently active.
  const fresh = (leads ?? [])
    .filter((l) => !have.has(l.id as string))
    .filter((l) => CAN_SEND[l.crm as string])
    .sort((a, b) => ((b.fields as LeadFields)?.crmScore ?? 0) - ((a.fields as LeadFields)?.crmScore ?? 0));
  const offset = have.size; // keep spreading as more leads arrive
  const rows = fresh.map((l, i) => ({ lead_id: l.id, org_id: s.org_id, user_id: s.user_id, next_at: firstTouchAt(offset + i, now) }));
  for (let i = 0; i < rows.length; i += 500) await db.from('nurture_state').insert(rows.slice(i, i + 500));
}

async function draftDue(s: Settings, limit: number, tz: string, quietEnd?: string) {
  const nowIso = new Date().toISOString();
  const { data: due } = await db
    .from('nurture_state')
    .select('lead_id, step, sent_home_ids')
    .eq('user_id', s.user_id)
    .eq('status', 'active')
    .lte('next_at', nowIso)
    .order('next_at')
    .limit(limit * 3);
  if (!due?.length) return 0;

  // Don't stack messages: skip leads that already have one waiting.
  const { data: waiting } = await db.from('drafts').select('lead_id').eq('user_id', s.user_id).eq('status', 'pending');
  const pendingFor = new Set((waiting ?? []).map((d) => d.lead_id as string));

  const { data: member } = await db.from('members').select('display_name, voice_profile').eq('org_id', s.org_id).eq('user_id', s.user_id).maybeSingle();
  const agentName = (member?.display_name as string) || 'your agent';
  const voice = (member?.voice_profile as { summary?: string } | null)?.summary;
  const credsCache = new Map<string, Awaited<ReturnType<typeof credentialsFor>> | null>();

  let drafted = 0;
  for (const st of due) {
    if (drafted >= limit) break;
    const leadId = st.lead_id as string;
    if (pendingFor.has(leadId)) continue;
    const { data: lead } = await db.from('leads').select('*').eq('id', leadId).maybeSingle<LeadRow & { pinned?: boolean }>();
    if (!lead) continue;
    const fields = (lead.fields ?? {}) as LeadFields;
    const later = (days: number) => db.from('nurture_state').update({ next_at: new Date(Date.now() + days * 86_400_000).toISOString(), updated_at: nowIso }).eq('lead_id', leadId);

    if (DONE_STAGE.test(lead.stage)) {
      await db.from('nurture_state').update({ status: 'stopped', stop_reason: `stage: ${lead.stage}`, updated_at: nowIso }).eq('lead_id', leadId);
      continue;
    }
    // The agent is on this one right now (new, just talked, pinned): try again later.
    if (!nurtureEligible({ createdAt: lead.crm_created_at, lastContactAt: lead.last_contact_at, fields, pinned: false }, Date.now())) {
      await later(3);
      continue;
    }
    const channel = pickChannel({ phone: lead.phone ?? undefined, email: lead.email ?? undefined, fields }, s.channels, s.mode === 'auto');
    if (!channel) {
      await db.from('nurture_state').update({ status: 'stopped', stop_reason: 'no way to reach (do-not-contact or no phone/email)', updated_at: nowIso }).eq('lead_id', leadId);
      continue;
    }

    // Find something worth sending.
    const sent = new Set((st.sent_home_ids as string[]) ?? []);
    const listing = await findListing(lead, fields, sent, credsCache, s.website_url);
    const community = await findCommunity(s.org_id, fields, sent);
    const touch = touchKind(fields, st.step as number, { home: !!listing, community: !!community });
    const home: HomeCard | null = touch === 'home' ? listing : touch === 'community' ? community : null;

    const { data: history } = await db.from('timeline_items').select('at, kind, title, body').eq('lead_id', leadId).order('at', { ascending: false }).limit(6);
    const prompt = nurturePrompt({
      agentName, channel, step: st.step as number, touch, home, voice,
      lead: { firstName: lead.first_name, source: lead.source ?? undefined, stage: lead.stage, createdAt: lead.crm_created_at, lastContactAt: lead.last_contact_at, fields },
      history: (history ?? []).map((h) => `${String(h.at).slice(0, 10)} ${h.kind}: ${h.title}${h.body ? ` — ${String(h.body).slice(0, 140)}` : ''}`),
    });

    let msg: { body: string; subject?: string; why: string };
    try {
      msg = await write(prompt, s);
    } catch (e) {
      console.error('nurture write failed', String(e).slice(0, 200));
      if (String(e).includes('no_ai_key') || String(e).includes('daily_cap')) break;
      continue;
    }

    const sendAfter = s.mode === 'auto' ? nextDaytime(tz, quietEnd) : null;
    await db.from('drafts').insert({
      org_id: s.org_id, lead_id: leadId, user_id: s.user_id, channel, play: 'nurture',
      subject: msg.subject ?? null, body: msg.body, why: msg.why, status: 'pending', home, send_after: sendAfter,
    });
    await db.from('nurture_state').update({
      step: (st.step as number) + 1,
      next_at: nextTouchAt(fields),
      sent_home_ids: home ? [...sent, home.id] : [...sent],
      updated_at: nowIso,
    }).eq('lead_id', leadId);
    drafted++;
  }
  return drafted;
}

/** A real MLS listing from the agent's own CRM that fits the lead. */
async function findListing(lead: LeadRow, f: LeadFields, sent: Set<string>, cache: Map<string, unknown>, website: string | null): Promise<HomeCard | null> {
  if (lead.crm !== 'lofty' || !lead.connection_id || !(f.areas?.length || f.budgetMax)) return null;
  if (!cache.has(lead.connection_id)) {
    const { data: conn } = await db.from('crm_connections').select('*').eq('id', lead.connection_id).maybeSingle<Connection>();
    cache.set(lead.connection_id, conn ? await credentialsFor(db, conn).catch(() => null) : null);
  }
  const creds = cache.get(lead.connection_id) as Awaited<ReturnType<typeof credentialsFor>> | null;
  if (!creds) return null;
  let rows: Record<string, unknown>[] | null = null;
  try {
    rows = await loftySearchListings(creds, { cities: f.areas, priceMin: f.budgetMin, priceMax: f.budgetMax, bedsMin: f.bedsMin });
  } catch (e) {
    console.error('listing search failed', String(e).slice(0, 200));
  }
  if (!rows) return null; // no listings permission yet
  for (const r of rows) {
    const card = toListingCard(r, website);
    if (card && !sent.has(card.id)) return card;
  }
  return null;
}

// Shape verified against a live Lofty /v2.0/listings/search response.
function toListingCard(r: Record<string, unknown>, website: string | null): HomeCard | null {
  const pick = (...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== null && v !== '');
  const id = pick('mlsListingId', 'listingId', 'id', 'mlsNumber');
  const address = pick('streetAddress', 'address', 'fullAddress', 'displayAddress');
  if (id == null || !address) return null;
  const price = Number(pick('price', 'listPrice', 'listingPrice')) || undefined;
  const photos = pick('photos', 'pictures', 'photoUrls', 'pictureList') as unknown;
  const photo = (Array.isArray(photos) ? photos[0] : pick('previewPicture', 'photo', 'picture', 'mainPhoto', 'coverPhoto')) as string | undefined;
  const url = pick('siteDetailLink', 'detailUrl', 'listingUrl', 'url', 'siteUrl') as string | undefined;
  return {
    kind: 'listing',
    id: `l:${id}`,
    title: String(address),
    city: pick('city') as string | undefined,
    price,
    beds: pick('beds', 'bedrooms') != null ? String(pick('beds', 'bedrooms')) : undefined,
    baths: Number(pick('baths', 'bathrooms')) || undefined,
    url: typeof url === 'string' ? url : undefined,
    photo: typeof photo === 'string' ? photo : undefined,
  };
}

/** A new-build community from the shared catalog (or the team's own) that fits. */
async function findCommunity(orgId: string, f: LeadFields, sent: Set<string>): Promise<HomeCard | null> {
  let q = db.from('communities').select('*').eq('active', true).or(`org_id.is.null,org_id.eq.${orgId}`).limit(50);
  if (f.areas?.length) q = q.in('city', f.areas);
  const { data } = await q;
  const fits = (data ?? []).filter((c) => {
    if (sent.has(`c:${c.id}`)) return false;
    if (f.budgetMax && c.price_from && c.price_from > f.budgetMax * 1.05) return false;
    if (f.budgetMin && c.price_to && c.price_to < f.budgetMin * 0.9) return false;
    return true;
  });
  if (!fits.length) return null;
  // Prefer the team's own picks, then the closest price.
  fits.sort((a, b) => Number(!!b.org_id) - Number(!!a.org_id) || Math.abs((a.price_from ?? 0) - (f.budgetMax ?? 0)) - Math.abs((b.price_from ?? 0) - (f.budgetMax ?? 0)));
  const c = fits[0];
  return {
    kind: 'community', id: `c:${c.id}`, title: c.name, subtitle: c.builder ?? undefined, city: c.city,
    priceFrom: c.price_from ?? undefined, url: c.url ?? undefined, photo: c.photo_url ?? undefined, highlights: c.highlights ?? undefined,
  };
}

async function write(prompt: string, s: Settings): Promise<{ body: string; subject?: string; why: string }> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('no_ai_key');
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await db.from('ai_usage').select('calls, input_tokens, output_tokens').eq('user_id', s.user_id).eq('day', day).maybeSingle();
  if ((usage?.calls ?? 0) >= Number(Deno.env.get('AI_DAILY_CALLS_PER_USER') ?? 300)) throw new Error('daily_cap');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`model ${res.status} ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  await db.from('ai_usage').upsert(
    {
      org_id: s.org_id, user_id: s.user_id, day,
      calls: (usage?.calls ?? 0) + 1,
      input_tokens: Number(usage?.input_tokens ?? 0) + (out.usage?.input_tokens ?? 0),
      output_tokens: Number(usage?.output_tokens ?? 0) + (out.usage?.output_tokens ?? 0),
    },
    { onConflict: 'user_id,day' },
  );
  const text = String(out.content?.[0]?.text ?? '');
  const parsed = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  if (!parsed.body) throw new Error('empty draft');
  return { body: String(parsed.body).trim(), subject: parsed.subject ? String(parsed.subject) : undefined, why: String(parsed.why ?? 'Keeping in touch') };
}

/** Auto mode: send drafts whose time has come, through the CRM, logged like any message. */
async function sendDueAuto() {
  const { data: rows } = await db
    .from('drafts')
    .select('id, org_id, lead_id, user_id, channel, subject, body')
    .eq('play', 'nurture')
    .eq('status', 'pending')
    .not('send_after', 'is', null)
    .lte('send_after', new Date().toISOString())
    .limit(200);
  for (const d of rows ?? []) {
    const { data: lead } = await db.from('leads').select('id, org_id, connection_id, crm, crm_lead_id').eq('id', d.lead_id).maybeSingle();
    if (!lead?.connection_id || !CAN_SEND[lead.crm as string]) continue;
    const now = new Date().toISOString();
    await db.from('sync_outbox').upsert(
      {
        org_id: lead.org_id, connection_id: lead.connection_id, lead_id: lead.id,
        op: d.channel === 'text' ? 'send_text' : 'send_email',
        idempotency_key: `nurture:${d.id}`,
        payload: d.channel === 'text' ? { crmLeadId: lead.crm_lead_id, body: d.body } : { crmLeadId: lead.crm_lead_id, email: { subject: d.subject ?? '', body: d.body } },
      },
      { onConflict: 'idempotency_key', ignoreDuplicates: true },
    );
    await db.from('timeline_items').insert({ org_id: lead.org_id, lead_id: lead.id, at: now, kind: d.channel, title: d.channel === 'text' ? 'Back 40 texted' : 'Back 40 emailed', body: d.body, source: 'back40', crm_ref: `nurture:${d.id}` });
    await db.from('drafts').update({ status: 'sent', decided_at: now }).eq('id', d.id);
    await db.from('nurture_state').update({ last_sent_at: now }).eq('lead_id', lead.id);
  }
}

// ── time helpers ──
function localParts(tz: string, at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hour12: false }).formatToParts(at).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) % 24 };
}

/** Auto mode sends between 9 AM and 7 PM local: now if inside the window, else the next 9 AM. */
function nextDaytime(tz: string, _quietEnd?: string): string {
  const now = new Date();
  const { hour } = localParts(tz, now);
  if (hour >= 9 && hour < 19) return now.toISOString();
  const hoursUntil9 = hour < 9 ? 9 - hour : 24 - hour + 9;
  return new Date(now.getTime() + hoursUntil9 * 3_600_000).toISOString();
}
