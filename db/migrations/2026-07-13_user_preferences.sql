-- Phase F: per-user priority ranking preference
--
-- Adds a user_preferences table storing each user's ranked order of the
-- three "Work on next" factors (dueDate, importance, complexity), set at
-- sign-up and used by lib/ordering.js's pickWorkOnNext to break ties in the
-- user's preferred order instead of a fixed default.
--
-- Also redefines delete_user() (see 2026-05-18_delete_user.sql) so account
-- deletion cleans up the preferences row too. CREATE OR REPLACE is
-- idempotent, so re-running this file is safe.
--
-- HOW TO INSTALL:
--   1. Open the Supabase dashboard for this project
--   2. SQL Editor → New query
--   3. Paste this entire file
--   4. Click Run
--
-- HOW TO REMOVE (if you ever need to roll back):
--   drop table if exists public.user_preferences;
--   -- then re-run 2026-05-18_delete_user.sql's create-or-replace body
--   -- without the added preferences delete line.

create table if not exists public.user_preferences (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  ranking    jsonb not null default '["dueDate","importance","complexity"]',
  updated_at timestamptz not null default now()
);

-- Ranking must be a JSON array containing exactly the three known factor
-- keys, each exactly once. Enforced with a function-based check constraint
-- since jsonb has no native "is a permutation of" operator.
--
-- The explicit length check matters beyond documentation: jsonb_array_elements_text
-- over an empty array produces zero rows, so array_agg over it returns NULL —
-- and `NULL = array[...]` evaluates to NULL, which a CHECK constraint treats
-- as satisfied (constraints only reject on an explicit FALSE). Without the
-- length check, '[]'::jsonb would silently pass this constraint.
create or replace function public.is_valid_ranking(r jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(r) = 'array'
    and jsonb_array_length(r) = 3
    and (select array_agg(value order by value) from jsonb_array_elements_text(r))
      = array['complexity', 'dueDate', 'importance'];
$$;

alter table public.user_preferences
  drop constraint if exists user_preferences_ranking_valid;

alter table public.user_preferences
  add constraint user_preferences_ranking_valid
  check (public.is_valid_ranking(ranking));

alter table public.user_preferences enable row level security;

drop policy if exists "select own preferences" on public.user_preferences;
create policy "select own preferences" on public.user_preferences
  for select using (auth.uid() = user_id);

drop policy if exists "insert own preferences" on public.user_preferences;
create policy "insert own preferences" on public.user_preferences
  for insert with check (auth.uid() = user_id);

drop policy if exists "update own preferences" on public.user_preferences;
create policy "update own preferences" on public.user_preferences
  for update using (auth.uid() = user_id);

-- Redefine delete_user() to also remove the caller's preferences row.
-- Body is identical to 2026-05-18_delete_user.sql plus one delete statement.
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

  -- user_preferences also has ON DELETE CASCADE on user_id (unlike
  -- assignments, which relies on this explicit delete since RLS alone
  -- can't reach it under SECURITY DEFINER) — kept explicit anyway so this
  -- function stays a complete, readable list of every table account
  -- deletion touches.
  delete from public.user_preferences where user_id = uid;
  delete from public.assignments where user_id = uid;
  delete from auth.users where id = uid;
end;
$$;

revoke all on function public.delete_user() from public;
grant execute on function public.delete_user() to authenticated;
