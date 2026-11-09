-- Leads belong to whoever they're assigned to in the CRM, not to whoever connected it.
-- crm_assignee_id keeps the CRM's own user id so leads move to an agent as soon as
-- that agent links their CRM user (see the trigger below).
alter table public.leads add column if not exists crm_assignee_id text;
create index if not exists leads_crm_assignee_idx on public.leads (org_id, crm_assignee_id);

create or replace function public.claim_crm_leads() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.crm_user_id is not null and new.crm_user_id is distinct from old.crm_user_id then
    update leads set assigned_user_id = new.user_id, updated_at = now()
    where org_id = new.org_id and crm_assignee_id = new.crm_user_id and connection_id is not null;
  end if;
  return new;
end $$;
revoke all on function public.claim_crm_leads() from public, anon, authenticated;

drop trigger if exists members_claim_crm_leads on public.members;
create trigger members_claim_crm_leads after update of crm_user_id on public.members
for each row execute function public.claim_crm_leads();
