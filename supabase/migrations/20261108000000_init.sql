-- Back 40 — initial schema.
-- Multi-tenant from day one: every row belongs to an organization (a team, or
-- a solo agent as an org of one). Row-level security enforces the walls in
-- the database itself, so a bug in the app can never leak one team's leads to
-- another.
--
-- Auth: works with Clerk (Supabase third-party auth) or Supabase Auth. The
-- user id is read from the JWT "sub" claim as text, so either works.

create extension if not exists pgcrypto;

create or replace function public.uid() returns text
language sql stable as $$ select coalesce(auth.jwt() ->> 'sub', '') $$;

-- ───────────────────────── Organizations & people ─────────────────────────

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  plan text not null default 'basic' check (plan in ('basic', 'pro', 'team')),
  seats int not null default 1,
  created_at timestamptz not null default now()
);

create table public.members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  role text not null default 'agent' check (role in ('owner', 'admin', 'agent')),
  display_name text not null,
  crm_user_id text,                 -- this person's id inside the CRM (maps CRM assignment → Back 40 user)
  daily_goal int,                   -- solo agents set their own; null = use team setting
  voice_profile jsonb,              -- learned writing style (opt-in)
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index members_user_idx on public.members (user_id);

create table public.org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  hot_stages text[] not null default array['New Lead', 'Active Buyer', 'Hot Prospect'],
  going_cold_days int not null default 2 check (going_cold_days = 2), -- locked: same for everyone
  today_cap int not null default 10 check (today_cap between 5 and 15),
  daily_goal int not null default 6 check (daily_goal between 1 and 50), -- team leader sets for the team
  morning_list_at time not null default '07:30',
  quiet_start time not null default '21:00',
  quiet_end time not null default '08:00',
  timezone text not null default 'America/Los_Angeles',
  autopilot jsonb not null default '{}'::jsonb -- per play + stage opt-in, all off by default
);

-- Helpers used by every policy. SECURITY DEFINER so they can read members
-- without recursive RLS checks.
create or replace function public.is_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = public.uid())
$$;

create or replace function public.is_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from members where org_id = o and user_id = public.uid() and role in ('owner', 'admin'))
$$;

-- ───────────────────────── CRM connections ─────────────────────────

create table public.crm_connections (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('lofty', 'followupboss', 'gohighlevel')),
  scope text not null default 'team' check (scope in ('team', 'agent')), -- teams connect once at admin level
  owner_user_id text,               -- for agent-scoped connections
  account_id text,                  -- e.g. GoHighLevel locationId
  secret_ref uuid,                  -- id of the token in Supabase Vault; tokens never live in this table
  webhook_secret text not null default encode(gen_random_bytes(24), 'hex'),
  status text not null default 'active' check (status in ('active', 'needs_reauth', 'paused')),
  backfill_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now()
);
create index crm_connections_org_idx on public.crm_connections (org_id);

-- ───────────────────────── Leads (the standard lead card) ─────────────────────────

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.crm_connections(id) on delete cascade,
  crm text not null,
  crm_lead_id text not null,
  assigned_user_id text,            -- Back 40 user (mapped from the CRM assignee)
  first_name text not null default '',
  last_name text not null default '',
  phone text,
  email text,
  stage text not null,
  source text,
  tags text[] not null default '{}',
  crm_created_at timestamptz not null,
  last_contact_at timestamptz,
  next_follow_up_at timestamptz,
  promise_note text,
  fields jsonb not null default '{}'::jsonb,   -- budget, timeline, beds, areas, pre-approval
  signals jsonb not null default '[]'::jsonb,  -- recent listing views, visits, replies
  touches int not null default 0,
  heat int not null default 0 check (heat between 0 and 100),
  label text,
  ai_summary text,
  ai_why_now text,
  ai_opener text,
  ai_updated_at timestamptz,
  crm_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (connection_id, crm_lead_id)
);
create index leads_today_idx on public.leads (org_id, assigned_user_id, heat desc);
create index leads_updated_idx on public.leads (org_id, updated_at desc);
create index leads_cold_idx on public.leads (org_id, last_contact_at);

create table public.lead_pins (
  user_id text not null,
  lead_id uuid not null references public.leads(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  pinned_at timestamptz not null default now(),
  primary key (user_id, lead_id)
);

create or replace function public.can_see_lead(l uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from leads x
    where x.id = l and (is_admin(x.org_id) or (is_member(x.org_id) and x.assigned_user_id = public.uid()))
  )
$$;

create table public.timeline_items (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  at timestamptz not null,
  kind text not null check (kind in ('call', 'note', 'text', 'email', 'stage', 'activity', 'created', 'task')),
  title text not null,
  body text,
  source text not null check (source in ('back40', 'crm')),
  outcome text,
  crm_ref text,                     -- CRM's id for dedupe
  unique (lead_id, source, crm_ref)
);
create index timeline_lead_idx on public.timeline_items (lead_id, at desc);

-- ───────────────────────── Calls, drafts, scores, nudges ─────────────────────────

create table public.call_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id text not null,
  outcome text not null check (outcome in ('talked', 'voicemail', 'no_answer', 'attempted')),
  note text,
  raw_transcript text,
  extracted jsonb,                  -- AI-pulled fields, saved only after the agent confirms
  follow_up_at timestamptz,
  stage_change text,
  duration_sec int,
  points int not null default 0,
  created_at timestamptz not null default now()
);
create index call_logs_user_day_idx on public.call_logs (user_id, created_at desc);

create table public.drafts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  user_id text not null,
  channel text not null check (channel in ('text', 'email')),
  play text not null check (play in ('speed_to_lead', 'no_answer', 'back40_sweep', 'recap', 'ask')),
  subject text,
  body text not null,
  why text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'skipped', 'edited_sent')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index drafts_pending_idx on public.drafts (user_id, status, created_at desc);

create table public.daily_activity (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  day date not null,
  calls int not null default 0,
  talked int not null default 0,
  points int not null default 0,
  score int not null default 0,
  stale_hot int not null default 0,
  primary key (user_id, day)
);
create index daily_activity_org_idx on public.daily_activity (org_id, day desc);

create table public.nudges (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  kind text not null check (kind in ('morning_list', 'new_lead', 'promise_due', 'going_cold', 'crm_activity', 'streak_risk', 'team_alert')),
  lead_id uuid references public.leads(id) on delete cascade,
  title text not null,
  body text not null,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  read_at timestamptz
);
create index nudges_user_idx on public.nudges (user_id, created_at desc);

create table public.push_tokens (
  user_id text not null,
  token text not null,
  platform text not null check (platform in ('ios', 'android', 'web')),
  updated_at timestamptz not null default now(),
  primary key (user_id, token)
);

-- ───────────────────────── Sync plumbing (server only) ─────────────────────────
-- Inbox: raw CRM webhooks land here first (fast 200 back to the CRM), then
-- workers process them. Outbox: every write to a CRM goes through here so
-- rate limits, retries and duplicates are handled in one place.

create table public.sync_inbox (
  id bigint generated always as identity primary key,
  connection_id uuid not null references public.crm_connections(id) on delete cascade,
  crm text not null,
  kind text not null,
  crm_lead_ids text[] not null default '{}',
  raw jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  attempts int not null default 0,
  last_error text
);
create index sync_inbox_pending_idx on public.sync_inbox (received_at) where processed_at is null;

create table public.sync_outbox (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid not null references public.crm_connections(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  op text not null check (op in ('add_note', 'log_call', 'update_lead', 'create_task', 'send_text', 'send_email')),
  payload jsonb not null,
  idempotency_key text not null unique, -- the same action can never be written twice
  status text not null default 'pending' check (status in ('pending', 'running', 'done', 'failed')),
  attempts int not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now()
);
create index sync_outbox_due_idx on public.sync_outbox (next_attempt_at) where status = 'pending';

-- Workers claim jobs with SKIP LOCKED so many workers can run in parallel safely.
create or replace function public.claim_outbox(batch int default 50)
returns setof public.sync_outbox
language sql security definer set search_path = public as $$
  update sync_outbox o set status = 'running', attempts = attempts + 1
  where o.id in (
    select id from sync_outbox
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at
    limit batch
    for update skip locked
  )
  returning o.*
$$;

create or replace function public.claim_inbox(batch int default 100)
returns setof public.sync_inbox
language sql security definer set search_path = public as $$
  update sync_inbox i set attempts = attempts + 1
  where i.id in (
    select id from sync_inbox
    where processed_at is null and attempts < 8
    order by received_at
    limit batch
    for update skip locked
  )
  returning i.*
$$;

-- CRM tokens live in Supabase Vault. Only the server (service role) can read them.
create or replace function public.read_crm_secret(ref uuid) returns text
language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where id = ref
$$;
revoke all on function public.read_crm_secret(uuid) from public, anon, authenticated;
grant execute on function public.read_crm_secret(uuid) to service_role;
revoke all on function public.claim_outbox(int) from public, anon, authenticated;
revoke all on function public.claim_inbox(int) from public, anon, authenticated;
grant execute on function public.claim_outbox(int), public.claim_inbox(int) to service_role;

-- AI cost guardrails: usage per user per day.
create table public.ai_usage (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  day date not null,
  calls int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (user_id, day)
);

-- ───────────────────────── Row-level security ─────────────────────────

alter table public.organizations enable row level security;
alter table public.members enable row level security;
alter table public.org_settings enable row level security;
alter table public.crm_connections enable row level security;
alter table public.leads enable row level security;
alter table public.lead_pins enable row level security;
alter table public.timeline_items enable row level security;
alter table public.call_logs enable row level security;
alter table public.drafts enable row level security;
alter table public.daily_activity enable row level security;
alter table public.nudges enable row level security;
alter table public.push_tokens enable row level security;
alter table public.sync_inbox enable row level security;   -- no policies: server only
alter table public.sync_outbox enable row level security;  -- no policies: server only
alter table public.ai_usage enable row level security;     -- no policies: server only

create policy org_read on public.organizations for select using (is_member(id));
create policy org_update on public.organizations for update using (is_admin(id));

create policy members_read on public.members for select using (is_member(org_id));
create policy members_admin on public.members for all using (is_admin(org_id)) with check (is_admin(org_id));
create policy members_self_update on public.members for update using (user_id = uid()) with check (user_id = uid());

create policy settings_read on public.org_settings for select using (is_member(org_id));
create policy settings_admin on public.org_settings for update using (is_admin(org_id));

-- Connections: admins manage team connections; agents see their own. Tokens are in Vault, not here.
create policy conn_read on public.crm_connections for select using (is_admin(org_id) or owner_user_id = uid());
create policy conn_admin on public.crm_connections for all using (is_admin(org_id)) with check (is_admin(org_id));

-- Leads: admins see the whole org; agents see leads assigned to them.
create policy leads_read on public.leads for select
  using (is_admin(org_id) or (is_member(org_id) and assigned_user_id = uid()));
create policy leads_update on public.leads for update
  using (is_admin(org_id) or (is_member(org_id) and assigned_user_id = uid()));

create policy pins_own on public.lead_pins for all using (user_id = uid() and can_see_lead(lead_id)) with check (user_id = uid() and can_see_lead(lead_id));

create policy timeline_read on public.timeline_items for select using (can_see_lead(lead_id));

create policy calls_read on public.call_logs for select using (can_see_lead(lead_id));
create policy calls_insert on public.call_logs for insert with check (user_id = uid() and can_see_lead(lead_id));

create policy drafts_own on public.drafts for select using (user_id = uid() or is_admin(org_id));
create policy drafts_decide on public.drafts for update using (user_id = uid()) with check (user_id = uid());

-- Leaderboard: everyone on the team can see scores.
create policy activity_read on public.daily_activity for select using (is_member(org_id));

create policy nudges_own on public.nudges for select using (user_id = uid());
create policy nudges_mark_read on public.nudges for update using (user_id = uid()) with check (user_id = uid());

create policy push_own on public.push_tokens for all using (user_id = uid()) with check (user_id = uid());

-- Realtime: the app subscribes to its own leads + nudges so CRM changes show up live.
alter publication supabase_realtime add table public.leads, public.nudges, public.drafts;
