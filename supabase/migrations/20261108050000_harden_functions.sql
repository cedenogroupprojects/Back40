alter function public.uid() set search_path = '';
revoke execute on function public.can_see_lead(uuid) from anon, public;
revoke execute on function public.is_admin(uuid) from anon, public;
revoke execute on function public.is_member(uuid) from anon, public;
revoke execute on function public.create_team(text, text) from anon, public;
grant execute on function public.can_see_lead(uuid), public.is_admin(uuid), public.is_member(uuid), public.create_team(text, text) to authenticated;
