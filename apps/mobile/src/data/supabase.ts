// Live data: Supabase (database + sign-in + server functions).
//
// Everything the app reads is protected by row-level security, so a user only
// ever sees their own team's rows. Every write to the CRM goes through a
// server function that queues it (idempotent, retried) — the app never holds
// a CRM key.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';
import { Platform } from 'react-native';

import type { CrmKind, Draft, Lead, LeadLabel, TimelineItem } from '@back40/core';

const extra = (Constants.expoConfig?.extra ?? {}) as { supabaseUrl?: string; supabaseAnonKey?: string };

export const isLive = Boolean(extra.supabaseUrl && extra.supabaseAnonKey);

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!isLive) throw new Error('Supabase not configured — running on sample data.');
  if (!client) {
    client = createClient(extra.supabaseUrl!, extra.supabaseAnonKey!, {
      auth: { storage: Platform.OS === 'web' ? undefined : AsyncStorage, persistSession: true, autoRefreshToken: true, detectSessionInUrl: Platform.OS === 'web' },
    });
  }
  return client;
}

/** Simple unique id for idempotent writes (same tap retried = same id). */
export function clientId() {
  const r = () => Math.random().toString(16).slice(2, 10);
  return `${Date.now().toString(16)}-${r()}-${r()}`;
}

async function fn<T = { ok: boolean }>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase().functions.invoke(name, { body });
  if (error) {
    // Pull the friendly message the function sent back, if any.
    const ctx = (error as { context?: Response }).context;
    const msg = ctx ? await ctx.json().then((j: { error?: string }) => j.error).catch(() => undefined) : undefined;
    throw new Error(msg ?? error.message);
  }
  return data as T;
}

// ───────────────────────── Sign-in ─────────────────────────

export async function getSession(): Promise<Session | null> {
  return (await supabase().auth.getSession()).data.session;
}

export function onAuthChange(cb: (s: Session | null) => void) {
  return supabase().auth.onAuthStateChange((_e, s) => cb(s)).data.subscription;
}

export async function signIn(email: string, password: string) {
  const { error } = await supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (error) throw new Error(/invalid/i.test(error.message) ? 'Wrong email or password.' : error.message);
}

export async function signUp(name: string, email: string, password: string, team: string) {
  await fn('account', { name, email, password });
  await signIn(email, password);
  const { error } = await supabase().rpc('create_team', { team_name: team, display_name: name });
  if (error) throw new Error(error.message);
}

// ───────────────────────── Team invites ─────────────────────────

export type InviteInfo = { team: string; leader: string; name: string | null; email: string | null; leads: number; used: boolean };
export const inviteInfo = (token: string) => fn<InviteInfo>('team', { action: 'info', token });

/** Sign up from an invite link: the account is created already on the team, then we sign in. */
export async function joinWithInvite(token: string, name: string, email: string, password: string) {
  await fn('account', { name, email, password, token });
  await signIn(email, password);
}

/** Already have a login: sign in, then join the team with the link. */
export async function signInAndJoin(token: string, email: string, password: string) {
  await signIn(email, password);
  await fn('team', { action: 'join', token });
}

export type TeamPerson = { crmUserId: string; name: string; email: string | null; status: 'joined' | 'invited' | 'none'; userId: string | null; leads: number };
export const fetchRoster = () => fn<{ connected: boolean; crm?: string; people: TeamPerson[] }>('team', { action: 'roster' });
export const makeInvite = (crmUserId: string) =>
  fn<{ link: string; message: string }>('team', { action: 'invite', crmUserId, origin: typeof window !== 'undefined' && window.location ? window.location.origin : undefined });
export const removeAgent = (userId: string) => fn('team', { action: 'remove', userId });

export async function signOut() {
  await supabase().auth.signOut();
}

// ───────────────────────── Reads ─────────────────────────

export type Profile = {
  userId: string;
  orgId: string;
  name: string;
  role: 'owner' | 'admin' | 'agent';
  teamName: string;
  dailyGoal: number;
  hotStages: string[];
  crm: { kind: CrmKind; status: string; lastSyncedAt: string | null } | null;
};

export async function fetchProfile(): Promise<Profile | null> {
  const db = supabase();
  const { data: userId } = await db.rpc('uid');
  if (!userId) return null;
  const { data: m } = await db.from('members').select('org_id, role, display_name, daily_goal').eq('user_id', userId).limit(1).maybeSingle();
  if (!m) return null;
  const [{ data: org }, { data: settings }, { data: conn }] = await Promise.all([
    db.from('organizations').select('name').eq('id', m.org_id).maybeSingle(),
    db.from('org_settings').select('daily_goal, hot_stages').eq('org_id', m.org_id).maybeSingle(),
    db.from('crm_connections').select('kind, status, last_synced_at').eq('org_id', m.org_id).order('created_at').limit(1).maybeSingle(),
  ]);
  return {
    userId: userId as string,
    orgId: m.org_id,
    name: m.display_name,
    role: m.role,
    teamName: org?.name ?? '',
    dailyGoal: m.daily_goal ?? settings?.daily_goal ?? 6,
    hotStages: settings?.hot_stages ?? [],
    crm: conn ? { kind: conn.kind, status: conn.status, lastSyncedAt: conn.last_synced_at } : null,
  };
}

type LeadRow = {
  id: string; org_id: string; crm: CrmKind; crm_lead_id: string; assigned_user_id: string | null;
  first_name: string; last_name: string; phone: string | null; email: string | null; stage: string; source: string | null;
  tags: string[]; crm_created_at: string; last_contact_at: string | null; next_follow_up_at: string | null; promise_note: string | null;
  fields: Lead['fields']; signals: Lead['signals']; touches: number; ai_summary: string | null; ai_why_now: string | null; ai_opener: string | null; label: LeadLabel | null;
};

function toLead(r: LeadRow, pinned: Set<string>): Lead {
  return {
    id: r.id, orgId: r.org_id, crm: r.crm, crmLeadId: r.crm_lead_id, assignedUserId: r.assigned_user_id,
    firstName: r.first_name, lastName: r.last_name, phone: r.phone ?? undefined, email: r.email ?? undefined,
    stage: r.stage, source: r.source ?? undefined, tags: r.tags ?? [], createdAt: r.crm_created_at,
    lastContactAt: r.last_contact_at, nextFollowUpAt: r.next_follow_up_at, promiseNote: r.promise_note ?? undefined,
    signals: r.signals ?? [], fields: r.fields ?? {}, pinned: pinned.has(r.id), touches: r.touches ?? 0, timeline: [],
    aiSummary: r.ai_summary ?? undefined, aiWhyNow: r.ai_why_now ?? undefined, aiOpener: r.ai_opener ?? undefined,
  } as Lead;
}

/** The user's leads, hottest first. Agents get their own; leaders get the team's. */
export async function fetchLeads(userId: string): Promise<Lead[]> {
  const db = supabase();
  const [{ data: rows, error }, { data: pins }] = await Promise.all([
    db.from('leads').select('*').eq('assigned_user_id', userId).order('heat', { ascending: false }).order('updated_at', { ascending: false }).limit(1000),
    db.from('lead_pins').select('lead_id').eq('user_id', userId),
  ]);
  if (error) throw error;
  const pinned = new Set((pins ?? []).map((p) => p.lead_id as string));
  return (rows as LeadRow[]).map((r) => toLead(r, pinned));
}

export async function fetchTimeline(leadId: string): Promise<TimelineItem[]> {
  const { data } = await supabase().from('timeline_items').select('id, at, kind, title, body, source, outcome').eq('lead_id', leadId).order('at', { ascending: false }).limit(60);
  return (data ?? []) as TimelineItem[];
}

export async function fetchDrafts(userId: string): Promise<Draft[]> {
  const { data } = await supabase().from('drafts').select('id, lead_id, channel, play, subject, body, why, status, home, home_options, alternatives').eq('user_id', userId).eq('status', 'pending').is('send_after', null).order('created_at', { ascending: true }).limit(60);
  return (data ?? []).map((d) => ({ id: d.id, leadId: d.lead_id, channel: d.channel, play: d.play, subject: d.subject ?? undefined, body: d.body, why: d.why, status: d.status, home: d.home ?? null, homeOptions: d.home_options ?? null, alternatives: d.alternatives ?? null })) as Draft[];
}

export async function fetchCallsSince(userId: string, sinceIso: string) {
  const { data } = await supabase().from('call_logs').select('outcome, created_at').eq('user_id', userId).gte('created_at', sinceIso);
  return (data ?? []) as { outcome: string; created_at: string }[];
}

/** Live updates: CRM changes show up without a refresh. */
export function subscribeToLeads(onChange: () => void) {
  const ch = supabase()
    .channel('back40-leads')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, onChange)
    .subscribe();
  return () => void supabase().removeChannel(ch);
}

// ───────────────────────── Writes (all go through the server) ─────────────────────────

export const connectCrm = (kind: CrmKind, apiKey: string, accountId?: string) =>
  fn<{ ok: boolean; imported: number; mine?: number; matchedYou?: boolean; more: boolean; webhooks: number }>('connect-crm', { kind, apiKey, accountId });

// ───────────────────────── Nurture ─────────────────────────

export type NurtureSettings = { enabled: boolean; mode: 'approve' | 'auto'; dailyLimit: number; channels: ('text' | 'email')[]; websiteUrl: string | null; offers: { text: string; url?: string }[] };
export const NURTURE_DEFAULTS: NurtureSettings = { enabled: false, mode: 'approve', dailyLimit: 15, channels: ['text', 'email'], websiteUrl: null, offers: [] };

export async function fetchNurture(orgId: string, userId: string): Promise<{ settings: NurtureSettings; active: number; dueThisWeek: number; stopped: number }> {
  const db = supabase();
  const weekAhead = new Date(Date.now() + 7 * 86_400_000).toISOString();
  const [{ data: s }, active, due, stopped] = await Promise.all([
    db.from('nurture_settings').select('enabled, mode, daily_limit, channels, website_url, offers').eq('org_id', orgId).eq('user_id', userId).maybeSingle(),
    db.from('nurture_state').select('lead_id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active'),
    db.from('nurture_state').select('lead_id', { count: 'exact', head: true }).eq('user_id', userId).eq('status', 'active').lte('next_at', weekAhead),
    db.from('nurture_state').select('lead_id', { count: 'exact', head: true }).eq('user_id', userId).neq('status', 'active'),
  ]);
  return {
    settings: s ? { enabled: s.enabled, mode: s.mode, dailyLimit: s.daily_limit, channels: s.channels, websiteUrl: s.website_url, offers: Array.isArray(s.offers) ? s.offers : [] } : NURTURE_DEFAULTS,
    active: active.count ?? 0,
    dueThisWeek: due.count ?? 0,
    stopped: stopped.count ?? 0,
  };
}

export async function saveNurture(orgId: string, userId: string, s: NurtureSettings) {
  const { error } = await supabase().from('nurture_settings').upsert(
    { org_id: orgId, user_id: userId, enabled: s.enabled, mode: s.mode, daily_limit: s.dailyLimit, channels: s.channels, website_url: s.websiteUrl, offers: s.offers, updated_at: new Date().toISOString() },
    { onConflict: 'org_id,user_id' },
  );
  if (error) throw error;
}

/** Write today's messages now instead of waiting for the morning run. */
export const runNurtureNow = (limit?: number) => fn<{ ok: boolean; drafted: number }>('nurture', { preview: true, limit });

/** Is this message's home still on the market? Checked right before sending. */
export const verifyDraft = (draftId: string) => fn<{ ok: boolean; error?: string }>('nurture', { action: 'verify', draftId });

/** Rewrite a nurture message around a different home from its options. */
export async function swapHome(draftId: string, homeId: string) {
  const r = await fn<{ ok: boolean; draft: { body: string; subject: string | null; why: string; home: Draft['home'] } }>('nurture', { action: 'swap', draftId, homeId });
  return r.draft;
}

/** Find homes for a waiting message (more = skip the ones already shown). */
export async function findHomes(draftId: string, more: boolean) {
  return fn<{ ok: boolean; options?: NonNullable<Draft['homeOptions']>; error?: string }>('nurture', { action: 'homes', draftId, more });
}

/** Rewrite a waiting message without a home. */
export async function dropHome(draftId: string) {
  const r = await fn<{ ok: boolean; draft: { body: string; subject: string | null; why: string; home: Draft['home'] } }>('nurture', { action: 'nohome', draftId });
  return r.draft;
}

export async function nurtureFor(leadId: string) {
  const { data } = await supabase().from('nurture_state').select('status, step, next_at, last_sent_at, stop_reason').eq('lead_id', leadId).maybeSingle();
  return data as { status: string; step: number; next_at: string; last_sent_at: string | null; stop_reason: string | null } | null;
}

export async function setNurturePaused(leadId: string, paused: boolean) {
  const { error } = await supabase().from('nurture_state').update({ status: paused ? 'paused' : 'active', updated_at: new Date().toISOString() }).eq('lead_id', leadId);
  if (error) throw error;
}

/** The stages a team's leads are in, with counts (for the pipeline board). */
export async function fetchTeamStages(): Promise<{ stage: string; n: number }[]> {
  const { data } = await supabase().rpc('team_stages');
  return ((data ?? []) as { stage: string; n: number }[]).map((r) => ({ stage: r.stage, n: Number(r.n) }));
}

export const disconnectCrm = (kind: CrmKind) => fn<{ ok: boolean; removed: number }>('connect-crm', { kind, action: 'disconnect' });

export const leadAction = (leadId: string, action: string, extra: Record<string, unknown> = {}) => fn('lead-action', { leadId, action, clientId: clientId(), ...extra });

export const logCallRemote = (payload: Record<string, unknown>) => fn<{ ok: boolean; points: number }>('log-call', { ...payload, clientId: clientId() });

export async function updateTeamSettings(orgId: string, patch: { daily_goal?: number; hot_stages?: string[] }) {
  await supabase().from('org_settings').update(patch).eq('org_id', orgId);
}

export type TeamRow = { id: string; name: string; initials: string; role: string; buckets: Record<string, number>; commission: number; stale: number };

/** Team admin: everyone on the team with their lead counts per stage (leaders only; RLS enforces it). */
export async function fetchTeam(orgId: string): Promise<TeamRow[]> {
  const db = supabase();
  const [{ data: members }, { data: rows }] = await Promise.all([
    db.from('members').select('user_id, display_name, role').eq('org_id', orgId),
    db.from('team_pipeline').select('assigned_user_id, stage, leads, stale_hot, potential_commission').eq('org_id', orgId),
  ]);
  return (members ?? []).map((m) => {
    const mine = (rows ?? []).filter((r) => r.assigned_user_id === m.user_id);
    const buckets: Record<string, number> = {};
    for (const r of mine) buckets[r.stage] = (buckets[r.stage] ?? 0) + r.leads;
    const parts = String(m.display_name).split(/\s+/);
    return {
      id: m.user_id,
      name: m.display_name,
      initials: `${parts[0]?.[0] ?? ''}${parts[1]?.[0] ?? ''}`.toUpperCase(),
      role: m.role,
      buckets,
      commission: mine.reduce((t, r) => t + Number(r.potential_commission ?? 0), 0),
      stale: mine.reduce((t, r) => t + r.stale_hot, 0),
    };
  });
}

/** Hot leads on the team with no contact in 2+ days (leaders see all). */
export async function fetchStale(orgId: string) {
  const since = new Date(Date.now() - 2 * 86_400_000).toISOString();
  const { data } = await supabase()
    .from('leads')
    .select('id, first_name, last_name, stage, last_contact_at, assigned_user_id')
    .eq('org_id', orgId)
    .in('label', ['brand_new', 'hot_now', 'promised', 'slipping'])
    .or(`last_contact_at.is.null,last_contact_at.lt.${since}`)
    .limit(50);
  return data ?? [];
}
