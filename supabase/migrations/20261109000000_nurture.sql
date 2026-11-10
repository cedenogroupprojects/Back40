-- Nurture: Back 40 keeps in touch with every lead that isn't on today's call list.
-- Each morning it writes a short, personal text or email per due lead (often with a
-- home or new-build community that fits them). The agent approves them in one tap,
-- or turns on "send automatically". Works the same for every agent and team.

-- Per agent. Off until the agent turns it on.
create table public.nurture_settings (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  enabled boolean not null default false,
  mode text not null default 'approve' check (mode in ('approve', 'auto')),
  daily_limit int not null default 15 check (daily_limit between 1 and 50),
  channels text[] not null default array['text', 'email'],
  website_url text,                       -- where home links point; filled from the CRM when we can
  last_run_on date,                       -- the agent's local date of the last morning batch
  updated_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

-- Per lead: where it is in the sequence and when the next touch is due.
create table public.nurture_state (
  lead_id uuid primary key references public.leads(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  status text not null default 'active' check (status in ('active', 'paused', 'replied', 'stopped')),
  step int not null default 0,            -- touches sent so far
  next_at timestamptz not null,
  last_sent_at timestamptz,
  sent_home_ids text[] not null default '{}', -- never send the same home twice
  stop_reason text,
  updated_at timestamptz not null default now()
);
create index nurture_due_idx on public.nurture_state (user_id, next_at) where status = 'active';

-- New-construction communities. One shared catalog, maintained by Back 40 for every
-- market; teams can add their own (org_id set) that only they see.
create table public.communities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = shared catalog
  name text not null,
  builder text,
  city text not null,
  state text not null default 'CA',
  price_from int,
  price_to int,
  beds_min int,
  beds_max int,
  url text,                                -- NewHomeSource or builder page
  photo_url text,
  highlights text,                         -- one line the AI may use ("3-car garages, no Mello-Roos")
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index communities_city_idx on public.communities (lower(city)) where active;

-- Drafts now carry the nurture play and the home they feature.
alter table public.drafts drop constraint drafts_play_check;
alter table public.drafts add constraint drafts_play_check check (play in ('speed_to_lead', 'no_answer', 'back40_sweep', 'recap', 'ask', 'nurture'));
alter table public.drafts add column if not exists home jsonb;      -- { kind: 'listing'|'community', title, price, beds, baths, city, url, photo }
alter table public.drafts add column if not exists send_after timestamptz; -- auto mode respects quiet hours

alter table public.nurture_settings enable row level security;
alter table public.nurture_state enable row level security;
alter table public.communities enable row level security;

create policy nurture_settings_own on public.nurture_settings for all
  using (user_id = uid() and is_member(org_id)) with check (user_id = uid() and is_member(org_id));
create policy nurture_state_read on public.nurture_state for select using (user_id = uid() or is_admin(org_id));
create policy nurture_state_pause on public.nurture_state for update using (user_id = uid()) with check (user_id = uid());
create policy communities_read on public.communities for select using (org_id is null or is_member(org_id));
create policy communities_team on public.communities for all using (org_id is not null and is_admin(org_id)) with check (org_id is not null and is_admin(org_id));

-- Morning batch runs every 15 minutes; the function decides whose morning it is.
create or replace function public.run_nurture() returns bigint
language sql security definer set search_path = public, vault, net as $$
  select net.http_post(
    url := 'https://aqihksotebhmxjudfnuo.supabase.co/functions/v1/nurture',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  )
$$;
revoke all on function public.run_nurture() from public, anon, authenticated;
select cron.schedule('back40-nurture', '*/15 * * * *', $$select public.run_nurture()$$);
