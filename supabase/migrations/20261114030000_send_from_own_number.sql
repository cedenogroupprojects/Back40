-- Texts and emails sent through the CRM go out from whoever owns the API key.
-- So an agent can only send through the CRM with their OWN key; the team key
-- is only ever used to send for the person who connected it.
create table if not exists public.member_send_keys (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id text not null,
  kind text not null,
  secret_ref uuid not null,
  crm_user_id text not null,
  created_at timestamptz not null default now(),
  primary key (org_id, user_id, kind)
);
alter table public.member_send_keys enable row level security;
create policy send_keys_self on public.member_send_keys for select using (user_id = uid());

-- Can the signed-in person send texts/emails through the CRM from their own number?
create or replace function public.can_send_from_crm() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from crm_connections where owner_user_id = uid() and status = 'active')
      or exists (select 1 from member_send_keys where user_id = uid());
$$;
grant execute on function public.can_send_from_crm() to authenticated;
