-- Hot stages are automatic by default (empty = read any CRM's stage names for
-- intent). Every team gets a settings row, even ones created before it existed.
alter table org_settings alter column hot_stages set default '{}';
insert into org_settings (org_id, hot_stages)
select o.id, '{}' from organizations o
where not exists (select 1 from org_settings s where s.org_id = o.id);
