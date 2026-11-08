-- Going live: team sign-up, CRM key storage, backfill, cron auth, new stage names.
alter table public.org_settings alter column hot_stages set default array['New Lead', 'Pre-Approved', 'Actively Looking', 'Submitting Offers'];

-- First sign-in: make a team of one (or the leader's team) and put the user in it as owner.
create or replace function public.create_team(team_name text, display_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare o uuid; me text := public.uid();
begin
  if me = '' then raise exception 'not signed in'; end if;
  select org_id into o from members where user_id = me limit 1;
  if o is not null then return o; end if;
  insert into organizations(name) values (coalesce(nullif(team_name, ''), display_name || '''s team')) returning id into o;
  insert into members(org_id, user_id, role, display_name) values (o, me, 'owner', display_name);
  insert into org_settings(org_id) values (o);
  return o;
end $$;
revoke all on function public.create_team(text, text) from public, anon;
grant execute on function public.create_team(text, text) to authenticated;

-- CRM keys go straight into Vault. Server only.
create or replace function public.store_crm_secret(secret_name text, secret text) returns uuid
language plpgsql security definer set search_path = public, vault as $$
declare existing uuid;
begin
  select id into existing from vault.secrets where name = secret_name;
  if existing is not null then
    perform vault.update_secret(existing, secret);
    return existing;
  end if;
  return vault.create_secret(secret, secret_name);
end $$;
revoke all on function public.store_crm_secret(text, text) from public, anon, authenticated;
grant execute on function public.store_crm_secret(text, text) to service_role;

-- The scheduled sync proves itself with a secret kept in Vault.
select vault.create_secret(encode(gen_random_bytes(24), 'hex'), 'cron_secret')
where not exists (select 1 from vault.secrets where name = 'cron_secret');
create or replace function public.cron_secret_ok(s text) returns boolean
language sql stable security definer set search_path = public, vault as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'cron_secret' and decrypted_secret = s)
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

create index if not exists lead_pins_user_idx on public.lead_pins (user_id);

alter publication supabase_realtime add table public.timeline_items;
