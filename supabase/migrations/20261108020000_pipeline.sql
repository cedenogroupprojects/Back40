-- Pipeline board + Team admin.
--
-- Each team maps the six board stages to the CRM stage names it actually uses
-- (defaults match packages/core/src/pipeline.ts). Moving a card updates
-- leads.stage and queues an update_lead job, like any other stage edit.
alter table public.org_settings
  add column pipeline_stages jsonb not null default
    '{"new":"New Lead","contacted":"Contacted","lender":"Sent to Lender","preapproved":"Pre-Approved","looking":"Actively Looking","offers":"Submitting Offers","escrow":"In Escrow"}'::jsonb;

create index leads_stage_idx on public.leads (org_id, assigned_user_id, stage);

-- Team admin: how many leads each agent has in each stage, how many hot leads
-- are going stale (hot, no contact in 2+ days), and potential commission.
-- security_invoker = the caller's row-level security applies, so an owner/admin
-- sees the whole team and an agent sees only their own row.
create view public.team_pipeline with (security_invoker = true) as
select
  l.org_id,
  l.assigned_user_id,
  l.stage,
  count(*)::int as leads,
  count(*) filter (
    where l.label in ('brand_new', 'hot_now', 'promised', 'slipping')
      and (l.last_contact_at is null or l.last_contact_at < now() - interval '2 days')
  )::int as stale_hot,
  coalesce(sum((l.fields ->> 'potentialCommission')::numeric), 0) as potential_commission
from public.leads l
group by l.org_id, l.assigned_user_id, l.stage;
