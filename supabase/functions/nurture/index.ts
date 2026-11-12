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
  checkHardRequirements, criteriaFromNotesPrompt, linkLast, DEAL_SEARCHES, DONE_STAGE, factCheckPrompt, firstTouchAt, listingCheckPrompt, loftyListingDetail, loftySearchListings,
  nextTouchAt, NOTES_READER_VERSION, nurtureEligible, nurturePrompt, parseCriteria, parseListingCheck, pickChannel, touchKind,
  type CrmKind, type DealKind, type HomeCard, type LeadFields, type Offer, type Touch,
} from '../_shared/core/index.ts';
import { credentialsFor, json, preflight, serviceClient, userClient, type Connection } from '../_shared/db.ts';

const MODEL = Deno.env.get('AI_MODEL_SMART') ?? 'claude-sonnet-5-5';
const FAST_MODEL = Deno.env.get('AI_MODEL_FAST') ?? 'claude-haiku-5-5';
const HOME_OPTIONS = 5;
const NOTES_PER_RUN = 15;
const LEADS_PER_RUN = 2; // overnight: a few leads every 15 minutes, so Lofty never sees a burst
const MAX_DETAIL_LOOKUPS = 10; // per lead
const LOFTY_GAP_MS = 1100; // space every Lofty call
const PROMPT_V = 3; // bump when the writing rules change; older waiting messages get rewritten

let lastLofty = 0;
async function paced<T>(fn: () => Promise<T>): Promise<T> {
  const wait = lastLofty + LOFTY_GAP_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastLofty = Date.now();
  return fn();
}
const NEVER = '1970-01-01T00:00:00.000Z'; // notesReadAt for 'checked, nothing to read yet'
const CAN_SEND: Record<string, boolean> = { lofty: true, gohighlevel: true }; // Follow Up Boss can't send through its API
const db = serviceClient();

type Settings = { org_id: string; user_id: string; enabled: boolean; mode: 'approve' | 'auto'; daily_limit: number; channels: ('text' | 'email')[]; website_url: string | null; last_run_on: string | null; offers?: Offer[] };
type LeadRow = {
  id: string; org_id: string; connection_id: string | null; crm: CrmKind | 'manual'; crm_lead_id: string; first_name: string; last_name: string;
  phone: string | null; email: string | null; stage: string; source: string | null; crm_created_at: string; last_contact_at: string | null; fields: LeadFields;
};

Deno.serve(async (req) => {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== 'POST') return json({ error: 'method' }, 405);
  const body = (await req.json().catch(() => ({}))) as { preview?: boolean; limit?: number; action?: 'swap' | 'verify' | 'homes' | 'nohome'; draftId?: string; homeId?: string; more?: boolean; refresh?: number };

  // Who's calling: the scheduler, or an agent asking for their batch now.
  const secret = req.headers.get('x-cron-secret');
  if (secret) {
    const { data: ok } = await db.rpc('cron_secret_ok', { s: secret });
    if (!ok) return json({ error: 'forbidden' }, 403);
    const { data: all } = await db.from('nurture_settings').select('*').eq('enabled', true);
    // Upgrade messages written before the hook/value/CTA rules: rewrite the oldest waiting ones.
    if (body.refresh) {
      const out: Record<string, number> = {};
      for (const s of (all ?? []) as Settings[]) out[s.user_id] = await refreshPending(s, Math.min(body.refresh, 25));
      return json({ ok: true, refreshed: out });
    }
    const results = [];
    for (const s of (all ?? []) as Settings[]) {
      try {
        results.push(await runFor(s, { force: false }));
      } catch (e) {
        console.error('nurture run failed', s.user_id, String(e).slice(0, 300));
      }
    }
    // Keep reading agents' notes for area/budget/beds, a batch every run, so
    // home matching works for every lead (not only the ones due today).
    for (const s of (all ?? []) as Settings[]) {
      try {
        await readPendingNotes(s, NOTES_PER_RUN);
      } catch (e) {
        console.error('notes backfill failed', s.user_id, String(e).slice(0, 300));
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
  if (body.action === 'swap') return swapHome(me as string, member.org_id as string, body.draftId ?? '', body.homeId ?? '');
  if (body.action === 'verify') return verifyDraft(me as string, body.draftId ?? '');
  if (body.action === 'homes') return homesFor(me as string, member.org_id as string, body.draftId ?? '', !!body.more);
  if (body.action === 'nohome') return dropHome(me as string, member.org_id as string, body.draftId ?? '');
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
  // Scheduled runs work overnight (from midnight, local time) a few leads at a time,
  // until today's limit is written, so everything is waiting when agents wake up.
  // Nothing is sent overnight: approve mode waits for a tap, auto mode for 9 AM.
  if (!opts.force && s.last_run_on === local.date) return { ran: false, drafted: 0 };
  if (!planAllows(s)) return { ran: false, drafted: 0 };
  await enroll(s);
  const since = startOfLocalDay(tz);
  const { count } = await db.from('drafts').select('id', { count: 'exact', head: true }).eq('user_id', s.user_id).eq('play', 'nurture').gte('created_at', since);
  const left = Math.max(0, s.daily_limit - (count ?? 0));
  const batch = opts.force ? (opts.limit ?? s.daily_limit) : Math.min(LEADS_PER_RUN, left);
  const drafted = batch > 0 ? await draftDue(s, batch, tz, org?.quiet_end as string | undefined) : 0;
  const finished = !opts.force && (left - drafted <= 0 || drafted === 0);
  if (finished) await db.from('nurture_settings').update({ last_run_on: local.date, updated_at: new Date().toISOString() }).eq('org_id', s.org_id).eq('user_id', s.user_id);
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
    .limit(Math.max(limit * 3, 60));
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
    let fields = (lead.fields ?? {}) as LeadFields;
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

    // The CRM often has area/budget blank while the agent's notes have it.
    fields = await criteriaFromNotes(lead, fields, s);

    // Find something worth sending: up to 5 coming-soon / new / price-drop homes.
    const sent = new Set((st.sent_home_ids as string[]) ?? []);
    const options = await homeOptions(lead, fields, sent, credsCache, s);
    const listing = options[0] ?? null;
    const community = await findCommunity(s.org_id, fields, sent);
    const offer = pickOffer(s.offers, st.step as number);
    const touch = touchKind(fields, st.step as number, { home: !!listing, community: !!community, offer: !!offer });
    const home: HomeCard | null = touch === 'home' || touch === 'teaser' ? listing : touch === 'community' ? community : null;

    const prompt = await promptFor(lead, fields, { agentName, voice, channel, step: st.step as number, touch, home, offer });

    let msg: { body: string; subject?: string; why: string };
    try {
      msg = await write(prompt, s);
      // Double-check: nothing about the home that the listing doesn't say.
      if (home?.kind === 'listing') {
        const check = await askModel(factCheckPrompt(msg.body, home), s, FAST_MODEL, 150).catch(() => ({ ok: true }) as Record<string, unknown>);
        if (check.ok === false) {
          msg = await write(`${prompt}\n\nIMPORTANT: a previous draft wrongly said "${String(check.problem ?? '').slice(0, 160)}". Mention only the listed numbers and verified MLS phrases.`, s);
          const again = await askModel(factCheckPrompt(msg.body, home), s, FAST_MODEL, 150).catch(() => ({ ok: true }) as Record<string, unknown>);
          if (again.ok === false) {
            console.error('fact check failed twice; skipping lead today', leadId);
            await later(1);
            continue;
          }
        }
      }
    } catch (e) {
      console.error('nurture write failed', String(e).slice(0, 200));
      if (String(e).includes('no_ai_key') || String(e).includes('daily_cap')) break;
      continue;
    }

    const sendAfter = s.mode === 'auto' ? nextDaytime(tz, quietEnd) : null;
    await db.from('drafts').insert({
      org_id: s.org_id, lead_id: leadId, user_id: s.user_id, channel, play: 'nurture',
      subject: msg.subject ?? null, body: msg.body, why: msg.why, status: 'pending', home, send_after: sendAfter, prompt_v: PROMPT_V,
      home_options: (touch === 'home' || touch === 'teaser') && options.length > 1 ? options : null,
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

/**
 * Up to 5 homes from the agent's own MLS access that fit the lead and are worth
 * a text today: coming soon, just listed (7 days), or price just dropped.
 *
 * Two steps, so a home is never sent unless it truly fits:
 *  1. Lofty's search narrows by what it filters reliably: cities, price, beds,
 *     baths, square feet, lot size, single story.
 *  2. Each remaining home's full MLS record is checked against the must-haves:
 *     HOA, garage, year built and lot size from its numbers; features like a
 *     pool or an ADU from the listing's own words. Can't confirm it? It's out.
 */
async function findListings(lead: LeadRow, f: LeadFields, sent: Set<string>, cache: Map<string, unknown>, s: Pick<Settings, 'org_id' | 'user_id'>): Promise<HomeCard[]> {
  if (lead.crm !== 'lofty' || !lead.connection_id || !(f.areas?.length || f.budgetMax)) return [];
  if (!cache.has(lead.connection_id)) {
    const { data: conn } = await db.from('crm_connections').select('*').eq('id', lead.connection_id).maybeSingle<Connection>();
    cache.set(lead.connection_id, conn ? await credentialsFor(db, conn).catch(() => null) : null);
  }
  const creds = cache.get(lead.connection_id) as Awaited<ReturnType<typeof credentialsFor>> | null;
  if (!creds) return [];
  // No floor given? Skip homes far under budget (mobile-home spaces, land, fixer shells).
  const q = { cities: f.areas, priceMin: f.budgetMin ?? (f.budgetMax ? Math.round(f.budgetMax * 0.55) : undefined), priceMax: f.budgetMax, bedsMin: f.bedsMin, bathsMin: f.bathsMin, sqftMin: f.sqftMin, lotMinSqft: f.lotMinSqft, singleStory: f.singleStory };
  const kinds = Object.keys(DEAL_SEARCHES) as DealKind[];
  const lists: HomeCard[][] = [];
  for (const k of kinds) {
    const rows = await paced(() => loftySearchListings(creds, q, 10, DEAL_SEARCHES[k] as Record<string, unknown>)).catch((e) => {
      console.error('listing search failed', k, String(e).slice(0, 200));
      return [] as Record<string, unknown>[];
    });
    lists.push(
      (rows ?? [])
        .map((r) => toListingCard(r, k))
        .filter((c): c is HomeCard => !!c && !sent.has(c.id))
        // Quick checks on the search row itself before spending a lookup.
        .filter((c) => !(f.yearBuiltMin && c.yearBuilt && c.yearBuilt < f.yearBuiltMin) && !(f.lotMinSqft && c.lotSqft && c.lotSqft < f.lotMinSqft)),
    );
  }
  // Round-robin: coming soon, new, price drop, coming soon, ...
  const candidates: HomeCard[] = [];
  const seen = new Set<string>();
  for (let i = 0; lists.some((l) => l.length > i); i++) {
    for (const l of lists) {
      const c = l[i];
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        candidates.push(c);
      }
    }
  }

  const must = f.mustHave ?? [];
  const needsRecord = must.length > 0 || !!(f.noHoa || f.garageMin || f.yearBuiltMin || f.lotMinSqft);
  const wants = [...must, ...(f.niceToHave ?? [])];
  const out: HomeCard[] = [];
  let lookups = 0;
  for (const c of candidates) {
    if (out.length >= HOME_OPTIONS) break;
    // Without hard requirements, only the top homes need their record (photos, quotable facts).
    if (!needsRecord && out.length >= 2) {
      out.push(c);
      continue;
    }
    if (!c.listingId || lookups >= MAX_DETAIL_LOOKUPS) {
      if (!needsRecord) out.push(c);
      continue;
    }
    lookups++;
    const d = await paced(() => loftyListingDetail(creds, c.listingId!)).catch(() => null);
    if (!d) {
      if (!needsRecord) out.push(c);
      continue;
    }
    if (d.status && !/^(active|coming soon)$/i.test(d.status)) continue;
    const hard = checkHardRequirements(f, d);
    if (hard) continue;
    const text = `${d.description} ${d.interiorFeatures} ${d.exterior}`;
    let facts: string[] = [];
    if (text.trim().length > 20) {
      const raw = await askModel(listingCheckPrompt(d, must, wants), s, FAST_MODEL, 300).catch(() => null);
      const res = parseListingCheck(raw, must, text);
      if (!res.ok) continue; // a must-have isn't clearly in the listing
      facts = res.facts;
    } else if (must.length) continue;
    out.push({ ...c, photos: d.photos.slice(0, 12), photo: c.photo ?? d.photos[0], hoaFee: d.hoaFee ?? undefined, garage: d.garage ?? undefined, yearBuilt: d.yearBuilt ?? c.yearBuilt, lotSqft: d.lotSqft ?? c.lotSqft, facts });
  }
  return out;
}

// Shape verified against a live Lofty /v2.0/listings/search response.
function toListingCard(r: Record<string, unknown>, badge?: DealKind): HomeCard | null {
  const pick = (...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== null && v !== '');
  const id = pick('mlsListingId', 'listingId', 'id', 'mlsNumber');
  const address = pick('streetAddress', 'address', 'fullAddress', 'displayAddress');
  if (id == null || !address) return null;
  const status = String(r.listingStatus ?? '');
  if (status && !/^(active|coming soon)$/i.test(status)) return null; // never pending / under contract
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
    badge: /coming soon/i.test(status) ? 'coming_soon' : badge,
    listingId: r.id != null ? String(r.id) : undefined,
    lotSqft: Number(r.lotSize) > 0 ? Number(r.lotSize) : undefined,
    yearBuilt: Number(r.builtYear) > 0 ? Number(r.builtYear) : undefined,
    sqft: Number(r.sqft) > 0 ? Number(r.sqft) : undefined,
    daysOnMarket: r.daysOnList != null ? Number(r.daysOnList) : undefined,
  };
}

/**
 * Homes for a lead. When we know nothing about what they want, fall back to the
 * agent's usual market (the cities and price most of their leads shop) so the
 * message can lead with a real home and ask if that's their area.
 */
async function homeOptions(lead: LeadRow, f: LeadFields, sent: Set<string>, cache: Map<string, unknown>, s: Pick<Settings, 'org_id' | 'user_id'>): Promise<HomeCard[]> {
  if (f.areas?.length || f.budgetMax) return findListings(lead, f, sent, cache, s);
  const m = await marketFor(s.user_id, cache);
  if (!m) return [];
  // Same market search for every lead tonight: do it once per run, then skip what each lead already got.
  const key = `mkthomes:${s.user_id}`;
  if (!cache.has(key)) cache.set(key, await findListings(lead, { areas: m.areas, budgetMax: m.budgetMax }, new Set(), cache, s));
  const list = (cache.get(key) as HomeCard[]).filter((h) => !sent.has(h.id));
  // Spread the market's homes across leads so everyone doesn't get the same one.
  const k = [...lead.id].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % Math.max(1, list.length);
  return [...list.slice(k), ...list.slice(0, k)];
}

/** The cities and price an agent's leads most often want (from their notes and CRM fields). */
async function marketFor(userId: string, cache: Map<string, unknown>): Promise<{ areas: string[]; budgetMax?: number } | null> {
  const k = `mkt:${userId}`;
  if (cache.has(k)) return cache.get(k) as { areas: string[]; budgetMax?: number } | null;
  const { data } = await db.from('leads').select('fields').eq('assigned_user_id', userId).not('fields->areas', 'is', null).limit(800);
  const counts = new Map<string, number>();
  const prices: number[] = [];
  for (const r of data ?? []) {
    const f = (r.fields ?? {}) as LeadFields;
    for (const a of f.areas ?? []) counts.set(a, (counts.get(a) ?? 0) + 1);
    if (f.budgetMax && f.budgetMax > 100_000 && f.budgetMax < 5_000_000) prices.push(f.budgetMax);
  }
  const areas = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([a]) => a);
  prices.sort((a, b) => a - b);
  const out = areas.length ? { areas, budgetMax: prices.length ? prices[Math.floor(prices.length / 2)] : undefined } : null;
  cache.set(k, out);
  return out;
}

/** Rotate through the agent's programs, one per message. */
function pickOffer(offers: Offer[] | undefined, step: number): Offer | null {
  const list = (offers ?? []).filter((o) => o && typeof o.text === 'string' && o.text.trim().length > 5);
  return list.length ? list[step % list.length]! : null;
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

async function write(prompt: string, s: Pick<Settings, 'org_id' | 'user_id'>, model = MODEL, maxTokens = 700): Promise<{ body: string; subject?: string; why: string }> {
  const parsed = await askModel(prompt, s, model, maxTokens);
  if (!parsed.body) throw new Error('empty draft');
  return { body: linkLast(String(parsed.body)), subject: parsed.subject ? String(parsed.subject) : undefined, why: String(parsed.why ?? 'Keeping in touch') };
}

async function askModel(prompt: string, s: Pick<Settings, 'org_id' | 'user_id'>, model: string, maxTokens: number): Promise<Record<string, unknown>> {
  const key = Deno.env.get('ANTHROPIC_API_KEY');
  if (!key) throw new Error('no_ai_key');
  const day = new Date().toISOString().slice(0, 10);
  const { data: usage } = await db.from('ai_usage').select('calls, input_tokens, output_tokens').eq('user_id', s.user_id).eq('day', day).maybeSingle();
  // The daily cap is for message writing. Quick reads (notes, listing checks) run on the
  // small model, cost a fraction, and are counted in tokens only, so they never block messages.
  const quick = model === FAST_MODEL;
  if (!quick && (usage?.calls ?? 0) >= Number(Deno.env.get('AI_DAILY_CALLS_PER_USER') ?? 300)) throw new Error('daily_cap');

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    // Room for the model to think before it answers (thinking counts toward max_tokens).
    body: JSON.stringify({ model, max_tokens: Math.max(maxTokens * 8, 4000), messages: [{ role: 'user', content: prompt }] }),
  });
  if (!res.ok) throw new Error(`model ${res.status} ${(await res.text()).slice(0, 200)}`);
  const out = await res.json();
  await db.from('ai_usage').upsert(
    {
      org_id: s.org_id, user_id: s.user_id, day,
      calls: (usage?.calls ?? 0) + (quick ? 0 : 1),
      input_tokens: Number(usage?.input_tokens ?? 0) + (out.usage?.input_tokens ?? 0),
      output_tokens: Number(usage?.output_tokens ?? 0) + (out.usage?.output_tokens ?? 0),
    },
    { onConflict: 'user_id,day' },
  );
  // Newer models can put a thinking block first: read the text block, wherever it is.
  const blocks = (out.content ?? []) as { type?: string; text?: string }[];
  const text = blocks.filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  try {
    return JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
  } catch (e) {
    console.error('model reply not JSON', model, out.stop_reason, blocks.map((b) => b.type).join(','), text.slice(0, 160));
    throw e;
  }
}

/** The message prompt for a lead, with its recent history (CRM notes included). */
async function promptFor(lead: LeadRow, fields: LeadFields, o: { agentName: string; voice?: string; channel: 'text' | 'email'; step: number; touch: Touch; home: HomeCard | null; offer?: Offer | null }) {
  const { data: history } = await db.from('timeline_items').select('at, kind, title, body').eq('lead_id', lead.id).order('at', { ascending: false }).limit(6);
  const variant = [...`${lead.id}:${o.step}`].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 11);
  return nurturePrompt({
    ...o,
    variant,
    now: new Date(),
    lead: { firstName: lead.first_name, source: lead.source ?? undefined, stage: lead.stage, createdAt: lead.crm_created_at, lastContactAt: lead.last_contact_at, fields },
    history: (history ?? []).map((h) => `${String(h.at).slice(0, 10)} ${h.kind}: ${h.title}${h.body ? ` — ${String(h.body).slice(0, 240)}` : ''}`),
  });
}

/**
 * Fill area / budget / beds from the agent's notes when the CRM fields are blank.
 * Runs once per new batch of notes; CRM values always win.
 */
async function criteriaFromNotes(lead: LeadRow, fields: LeadFields, s: Pick<Settings, 'org_id' | 'user_id'>): Promise<LeadFields> {
  const mark = async () => {
    if (fields.notesReadAt && fields.notesReadV === NOTES_READER_VERSION) return fields;
    const next = { ...fields, notesReadAt: fields.notesReadAt ?? NEVER, notesReadV: NOTES_READER_VERSION };
    await db.from('leads').update({ fields: next }).eq('id', lead.id);
    return next;
  };
  const { data: notes } = await db.from('timeline_items').select('at, body').eq('lead_id', lead.id).eq('kind', 'note').order('at', { ascending: false }).limit(12);
  const latest = notes?.[0]?.at ? new Date(notes[0].at as string).toISOString() : undefined;
  if (!latest) return mark();
  if (fields.notesReadAt && fields.notesReadAt >= latest && fields.notesReadV === NOTES_READER_VERSION) return fields;
  let found: ReturnType<typeof parseCriteria> = {};
  try {
    found = parseCriteria(await askModel(criteriaFromNotesPrompt(notes!.map((n) => String(n.body ?? ''))), s, FAST_MODEL, 400));
  } catch (e) {
    console.error('notes read failed', String(e).slice(0, 200));
    return fields;
  }
  const next: LeadFields = {
    ...fields,
    areas: fields.areas?.length ? fields.areas : found.areas,
    budgetMin: fields.budgetMin ?? (fields.budgetMax ? undefined : found.budgetMin),
    budgetMax: fields.budgetMax ?? found.budgetMax,
    bedsMin: fields.bedsMin ?? found.bedsMin,
    // From the notes only (the CRM has no field for these). A fresh read replaces the old one.
    bathsMin: found.bathsMin,
    sqftMin: found.sqftMin,
    lotMinSqft: found.lotMinSqft,
    singleStory: found.singleStory,
    yearBuiltMin: found.yearBuiltMin,
    garageMin: found.garageMin,
    noHoa: found.noHoa,
    mustHave: found.mustHave,
    niceToHave: found.niceToHave,
    notesReadAt: latest,
    notesReadV: NOTES_READER_VERSION,
  };
  await db.from('leads').update({ fields: next }).eq('id', lead.id);
  return next;
}

/** Read notes for leads we haven't read yet (newest activity first). */
async function readPendingNotes(s: Settings, max: number) {
  const { data: rows } = await db
    .from('leads')
    .select('*')
    .eq('org_id', s.org_id)
    .eq('assigned_user_id', s.user_id)
    .or(`fields->>notesReadV.is.null,fields->>notesReadV.neq.${NOTES_READER_VERSION}`)
    .order('updated_at', { ascending: false })
    .limit(max);
  for (const lead of (rows ?? []) as LeadRow[]) {
    if (DONE_STAGE.test(lead.stage)) continue;
    await criteriaFromNotes(lead, (lead.fields ?? {}) as LeadFields, s);
  }
}

/** Right before a message goes out: is the home still on the market? */
async function homeStillAvailable(leadId: string, home: HomeCard | null): Promise<{ ok: boolean; status?: string }> {
  if (!home || home.kind !== 'listing' || !home.listingId) return { ok: true };
  const { data: lead } = await db.from('leads').select('connection_id').eq('id', leadId).maybeSingle();
  if (!lead?.connection_id) return { ok: true };
  const { data: conn } = await db.from('crm_connections').select('*').eq('id', lead.connection_id).maybeSingle<Connection>();
  const creds = conn ? await credentialsFor(db, conn).catch(() => null) : null;
  if (!creds) return { ok: true };
  const d = await paced(() => loftyListingDetail(creds, home.listingId!)).catch(() => undefined);
  if (d === undefined) return { ok: true }; // Lofty hiccup: don't block the agent
  if (!d) return { ok: false, status: 'off the market' };
  return /^(active|coming soon)$/i.test(d.status) ? { ok: true } : { ok: false, status: d.status.toLowerCase() || 'off the market' };
}

async function verifyDraft(me: string, draftId: string) {
  const { data: d } = await db.from('drafts').select('id, lead_id, home').eq('id', draftId).eq('user_id', me).maybeSingle();
  if (!d) return json({ ok: true });
  const r = await homeStillAvailable(d.lead_id as string, d.home as HomeCard | null);
  return json(r.ok ? { ok: true } : { ok: false, error: `This home just went ${r.status}. Pick a different home before sending.` });
}

type DraftRow = { id: string; lead_id: string; channel: 'text' | 'email'; subject: string | null; home: HomeCard | null; home_options: HomeCard[] | null };

async function loadDraft(me: string, draftId: string) {
  const { data: d } = await db.from('drafts').select('*').eq('id', draftId).eq('user_id', me).eq('status', 'pending').maybeSingle<DraftRow>();
  if (!d) return null;
  const { data: lead } = await db.from('leads').select('*').eq('id', d.lead_id).maybeSingle<LeadRow>();
  if (!lead) return null;
  const { data: st } = await db.from('nurture_state').select('step, sent_home_ids').eq('lead_id', lead.id).maybeSingle();
  return { d, lead, st };
}

/** Rewrite a waiting message around a different home (or none), keeping everything else. */
async function rewrite(me: string, orgId: string, x: NonNullable<Awaited<ReturnType<typeof loadDraft>>>, home: HomeCard | null) {
  const { d, lead, st } = x;
  const fields = (lead.fields ?? {}) as LeadFields;
  const { data: member } = await db.from('members').select('display_name, voice_profile').eq('org_id', orgId).eq('user_id', me).maybeSingle();
  const { data: ns } = await db.from('nurture_settings').select('offers').eq('org_id', orgId).eq('user_id', me).maybeSingle();
  const step = Math.max(0, Number(st?.step ?? 1) - 1); // the draft was written for the step before the bump
  const knows = !!(fields.areas?.length || fields.budgetMax);
  const offer = home ? null : pickOffer(ns?.offers as Offer[] | undefined, step);
  const touch: Touch = home ? (home.kind === 'community' ? 'community' : knows ? 'home' : 'teaser') : offer ? 'offer' : 'discovery';
  const prompt = await promptFor(lead, fields, {
    agentName: (member?.display_name as string) || 'your agent',
    voice: (member?.voice_profile as { summary?: string } | null)?.summary,
    channel: d.channel, step, touch, home, offer,
  });
  let msg: Awaited<ReturnType<typeof write>>;
  try {
    msg = await write(prompt, { org_id: orgId, user_id: me });
    if (home?.kind === 'listing') {
      const check = await askModel(factCheckPrompt(msg.body, home), { org_id: orgId, user_id: me }, FAST_MODEL, 150).catch(() => ({ ok: true }) as Record<string, unknown>);
      if (check.ok === false) msg = await write(`${prompt}\n\nIMPORTANT: a previous draft wrongly said "${String(check.problem ?? '').slice(0, 160)}". Mention only the listed numbers and verified MLS phrases.`, { org_id: orgId, user_id: me });
    }
  } catch (e) {
    console.error('rewrite failed', String(e).slice(0, 200));
    return json({ error: String(e).includes('daily_cap') ? 'Daily AI limit reached. Try tomorrow.' : 'Could not rewrite the message. Try again.' }, 500);
  }
  const sentIds = ((st?.sent_home_ids ?? []) as string[]).filter((id) => id !== d.home?.id);
  await db.from('nurture_state').update({ sent_home_ids: home ? [...sentIds, home.id] : sentIds, updated_at: new Date().toISOString() }).eq('lead_id', lead.id);
  const { data: updated } = await db.from('drafts').update({ body: msg.body, subject: msg.subject ?? d.subject, why: msg.why, home, prompt_v: PROMPT_V }).eq('id', d.id).select('*').single();
  return json({ ok: true, draft: updated });
}

/** The agent picked one of the home options: rewrite the message around it. */
async function swapHome(me: string, orgId: string, draftId: string, homeId: string) {
  const x = await loadDraft(me, draftId);
  if (!x) return json({ error: 'That message was already sent or removed.' }, 404);
  const home = (x.d.home_options ?? []).find((h) => h.id === homeId);
  if (!home) return json({ error: 'That home is no longer available.' }, 400);
  return rewrite(me, orgId, x, home);
}

/** Send it without a home: rewrite as a program or a question. */
async function dropHome(me: string, orgId: string, draftId: string) {
  const x = await loadDraft(me, draftId);
  if (!x) return json({ error: 'That message was already sent or removed.' }, 404);
  return rewrite(me, orgId, x, null);
}

/**
 * Find homes for any waiting message, on demand (also for messages that were
 * written without one). more = skip the homes already shown.
 */
async function homesFor(me: string, orgId: string, draftId: string, more: boolean) {
  const x = await loadDraft(me, draftId);
  if (!x) return json({ error: 'That message was already sent or removed.' }, 404);
  const { d, lead, st } = x;
  if (lead.crm !== 'lofty') return json({ ok: false, error: 'Homes come from Lofty for now. Connect Lofty to add homes.' });
  const fields = (lead.fields ?? {}) as LeadFields;
  const skip = new Set<string>((st?.sent_home_ids ?? []) as string[]);
  if (d.home) skip.delete(d.home.id);
  if (more) for (const h of d.home_options ?? []) if (h.id !== d.home?.id) skip.add(h.id);
  const cache = new Map<string, unknown>();
  const found = await homeOptions(lead, fields, skip, cache, { org_id: orgId, user_id: me });
  if (!found.length) {
    const knows = !!(fields.areas?.length || fields.budgetMax);
    return json({
      ok: false,
      error: knows
        ? `No coming-soon, new or price-drop homes fit ${lead.first_name || 'them'} right now.`
        : `We don't know where ${lead.first_name || 'they'} wants to buy yet. Add a city or price to their notes in Lofty.`,
    });
  }
  const options = d.home && !found.some((h) => h.id === d.home!.id) ? [d.home, ...found] : found;
  await db.from('drafts').update({ home_options: options }).eq('id', d.id);
  return json({ ok: true, options });
}

/** Rewrite waiting messages written with older rules (keeps their home, or finds one if they have none). */
async function refreshPending(s: Settings, n: number) {
  const { data: rows } = await db.from('drafts').select('id').eq('user_id', s.user_id).eq('play', 'nurture').eq('status', 'pending').lt('prompt_v', PROMPT_V).is('send_after', null).order('created_at').limit(n);
  let done = 0;
  const cache = new Map<string, unknown>();
  for (const r of rows ?? []) {
    const x = await loadDraft(s.user_id, r.id as string);
    if (!x) continue;
    let home = x.d.home;
    if (!home) {
      const fields = (x.lead.fields ?? {}) as LeadFields;
      const sent = new Set<string>((x.st?.sent_home_ids ?? []) as string[]);
      const options = await homeOptions(x.lead, fields, sent, cache, s).catch(() => [] as HomeCard[]);
      if (options.length > 1) {
        await db.from('drafts').update({ home_options: options }).eq('id', x.d.id);
        x.d.home_options = options;
      }
      const step = Math.max(0, Number(x.st?.step ?? 1) - 1);
      const touch = touchKind(fields, step, { home: options.length > 0, community: false, offer: !!pickOffer(s.offers, step) });
      home = touch === 'home' || touch === 'teaser' ? options[0]! : null;
    }
    const res = await rewrite(s.user_id, s.org_id, x, home);
    if (res.status === 200) done++;
    else if (res.status === 500) break; // AI limit
  }
  return done;
}

/** Auto mode: send drafts whose time has come, through the CRM, logged like any message. */
async function sendDueAuto() {
  const { data: rows } = await db
    .from('drafts')
    .select('id, org_id, lead_id, user_id, channel, subject, body, home')
    .eq('play', 'nurture')
    .eq('status', 'pending')
    .not('send_after', 'is', null)
    .lte('send_after', new Date().toISOString())
    .limit(200);
  for (const d of rows ?? []) {
    const { data: lead } = await db.from('leads').select('id, org_id, connection_id, crm, crm_lead_id').eq('id', d.lead_id).maybeSingle();
    if (!lead?.connection_id || !CAN_SEND[lead.crm as string]) continue;
    const avail = await homeStillAvailable(lead.id as string, (d as { home?: HomeCard | null }).home ?? null);
    if (!avail.ok) {
      // Don't send a home that just went pending: hand it back to the agent.
      await db.from('drafts').update({ send_after: null, why: `Held: the home went ${avail.status}. Pick another.` }).eq('id', d.id);
      continue;
    }
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
/** ISO time of the most recent local midnight in a time zone. */
function startOfLocalDay(tz: string, at = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(at).map((x) => [x.type, x.value]));
  const secs = (Number(p.hour) % 24) * 3600 + Number(p.minute) * 60 + Number(p.second);
  return new Date(at.getTime() - secs * 1000).toISOString();
}

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
