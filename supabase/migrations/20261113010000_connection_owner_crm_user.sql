-- The CRM user id of whoever connected this CRM. Lets one person have two CRMs
-- connected (e.g. Lofty + GoHighLevel) without one overwriting the other's id.
alter table crm_connections add column if not exists owner_crm_user_id text;
