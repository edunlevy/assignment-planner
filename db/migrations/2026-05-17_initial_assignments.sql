-- Initial schema: the assignments table + Row Level Security.
--
-- This is the deployable baseline every later migration builds on
-- (complexity, due_time, user_preferences, delete_user). Previously it lived
-- only in NOTES.md, so a fresh environment applying `db/migrations` alone would
-- fail (the table didn't exist) or — worse — silently miss the RLS policy that
-- isolates each user's rows. Runs BEFORE 2026-05-18_delete_user.sql.
--
-- It is safe to run against an existing project: every statement is idempotent.
-- On a project created via the old NOTES.md SQL it is a no-op EXCEPT that it
-- upgrades the table to REPLICA IDENTITY FULL (see the realtime note below) —
-- which is the intended correction, and still safe to re-run.
--
-- HOW TO INSTALL:
--   1. Open the Supabase dashboard for this project
--   2. SQL Editor → New query
--   3. Paste this entire file
--   4. Click Run
--
-- HOW TO REMOVE (destroys all assignment data — be sure):
--   drop table if exists public.assignments cascade;

-- Base table. Later migrations add `complexity` (2026-05-27) and `due_time`
-- (2026-05-29), so they are intentionally absent here.
create table if not exists public.assignments (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  class_name  text        not null,
  title       text        not null,
  due_date    date        not null,
  importance  int         not null default 3,
  status      text        not null default 'not_started',
  series_id   text,                          -- nullable; links recurring occurrences
  created_at  timestamptz not null default now(),

  constraint importance_range check (importance between 1 and 5),
  constraint valid_status     check (status in ('not_started', 'in_progress', 'completed'))
);

-- Row Level Security: each user may only read/write their own rows.
alter table public.assignments enable row level security;

-- Idempotent policy create (CREATE POLICY has no IF NOT EXISTS).
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'assignments'
      and policyname = 'Users manage own assignments'
  ) then
    create policy "Users manage own assignments"
      on public.assignments
      for all
      using      (auth.uid() = user_id)
      with check (auth.uid() = user_id);
  end if;
end
$$;

-- Realtime: the app subscribes to postgres_changes on this table (see NOTES.md
-- "Phase D — Realtime sync") with a `user_id=eq.<uid>` filter that applies to
-- every event type, DELETE included (hooks/useRealtimeSync.js).
--
-- REPLICA IDENTITY FULL is REQUIRED (not optional as NOTES.md implies): under
-- the default replica identity, a DELETE's `old` record carries only the
-- primary key, so `user_id` is absent and Supabase Realtime cannot evaluate the
-- user_id filter — the DELETE is then never delivered to other devices, and a
-- row deleted on one device lingers (and keeps its reminders) on another. FULL
-- puts every column in `old`, so the filter matches and cross-device deletes
-- sync. (FULL is idempotent; safe to re-run.)
alter table public.assignments replica identity full;

-- Add the table to the realtime publication. Wrapped so it is idempotent and
-- degrades to a no-op on a non-Supabase Postgres with no `supabase_realtime`
-- publication.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'assignments'
  ) then
    alter publication supabase_realtime add table public.assignments;
  end if;
exception
  when undefined_object then
    null; -- no supabase_realtime publication in this environment; skip
end
$$;
