-- Disconnecting a CRM removes its stored key. Server only.
create or replace function public.delete_crm_secret(secret_name text) returns void
language sql security definer set search_path = public, vault as $$
  delete from vault.secrets where name = secret_name;
$$;
revoke all on function public.delete_crm_secret(text) from public, anon, authenticated;
grant execute on function public.delete_crm_secret(text) to service_role;
