-- Leads added by hand in Back 40 (no CRM, or the agent chose not to connect).
-- They have crm = 'manual', no connection, and crm_lead_id = their own id.
alter table public.leads alter column connection_id drop not null;
create index if not exists leads_manual_idx on public.leads (org_id) where connection_id is null;
