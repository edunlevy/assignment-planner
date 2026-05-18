-- Phase 22h: in-app account deletion (Apple App Store Review Guideline 5.1.1(v))
--
-- Creates a SECURITY DEFINER function that lets an authenticated user hard-delete
-- their own auth record + all their assignment rows in one transaction. The
-- function runs with the privileges of its owner (postgres) so it can DELETE
-- from auth.users, but it only ever operates on auth.uid() — never another user.
--
-- HOW TO INSTALL:
--   1. Open the Supabase dashboard for this project
--   2. SQL Editor → New query
--   3. Paste this entire file
--   4. Click Run
--   5. Verify under Database → Functions that `delete_user` appears
--
-- HOW TO REMOVE (if you ever need to roll back):
--   drop function if exists public.delete_user();

create or replace function public.delete_user()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Delete all assignments owned by this user. RLS would also enforce this,
  -- but the SECURITY DEFINER bypass means we have to be explicit.
  delete from public.assignments where user_id = uid;

  -- Delete the auth user record itself. Cascade in auth schema handles
  -- sessions, refresh tokens, identities, etc.
  delete from auth.users where id = uid;
end;
$$;

-- Only authenticated callers can invoke; anon role cannot.
revoke all on function public.delete_user() from public;
grant execute on function public.delete_user() to authenticated;
