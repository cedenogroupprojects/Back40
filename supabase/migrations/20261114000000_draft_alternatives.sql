-- Each follow-up is written three ways; the agent picks one. body = the first.
alter table drafts add column if not exists alternatives jsonb;
