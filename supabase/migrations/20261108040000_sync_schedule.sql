create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Run the sync worker every minute. The secret lives in Vault; the worker checks it.
-- NOTE: replace the project ref in the URL when deploying to another project.
create or replace function public.run_sync_worker() returns bigint
language sql security definer set search_path = public, vault, net as $$
  select net.http_post(
    url := 'https://aqihksotebhmxjudfnuo.supabase.co/functions/v1/sync-worker',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 55000
  )
$$;
revoke all on function public.run_sync_worker() from public, anon, authenticated;

select cron.schedule('back40-sync', '* * * * *', $$select public.run_sync_worker()$$);
