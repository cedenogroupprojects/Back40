-- The stages a team's leads are actually in (names + counts), so the app's
-- pipeline mirrors the CRM instead of imposing fixed columns.
create or replace function public.team_stages() returns table(stage text, n bigint)
language sql stable security definer set search_path = public as $$
  select l.stage, count(*) from leads l
  where l.org_id in (select org_id from members where user_id = public.uid())
  group by l.stage
$$;
revoke all on function public.team_stages() from public, anon;
grant execute on function public.team_stages() to authenticated;
