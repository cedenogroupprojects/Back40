-- Team invites: the team leader invites agents from their CRM's user list. Each
-- invite is a one-time link tied to that agent's CRM user, so their leads land on
-- their list the moment they join.
create table if not exists public.team_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  token text not null unique,
  crm_user_id text not null,
  name text,
  email text,
  created_by text not null,
  created_at timestamptz not null default now(),
  used_by text,
  used_at timestamptz,
  unique (org_id, crm_user_id)
);
alter table public.team_invites enable row level security;
create policy invites_admin on public.team_invites for select using (is_admin(org_id));

-- Agents may edit their own member row (name, goal, voice) but never their role,
-- team or CRM link: only a team admin (or the server) changes those.
create or replace function public.members_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.role() = 'service_role' or is_admin(old.org_id) then return new; end if;
  if new.role is distinct from old.role or new.org_id is distinct from old.org_id or new.crm_user_id is distinct from old.crm_user_id then
    raise exception 'Only your team leader can change that.';
  end if;
  return new;
end $$;
drop trigger if exists members_guard on public.members;
create trigger members_guard before update on public.members for each row execute function public.members_guard();
