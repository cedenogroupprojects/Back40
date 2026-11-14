-- Lead counts per CRM user, for the Team screen (one query instead of one per agent).
create or replace function public.lead_counts_by_assignee(p_org uuid)
returns table (crm_assignee_id text, n bigint)
language sql stable security definer set search_path = public as $$
  select crm_assignee_id, count(*) from leads
  where org_id = p_org and crm_assignee_id is not null
  group by crm_assignee_id
$$;
revoke all on function public.lead_counts_by_assignee(uuid) from public, anon, authenticated;
