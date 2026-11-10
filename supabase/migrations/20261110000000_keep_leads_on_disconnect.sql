-- Disconnecting a CRM no longer deletes the team's leads, history or nurture.
-- Leads keep their data with no connection; reconnecting the same CRM re-attaches them.
alter table public.leads drop constraint leads_connection_id_fkey;
alter table public.leads add constraint leads_connection_id_fkey
  foreign key (connection_id) references public.crm_connections(id) on delete set null;
