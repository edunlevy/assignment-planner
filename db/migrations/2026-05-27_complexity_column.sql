-- Phase E: complexity / length gauge
--
-- Adds a `complexity` column to assignments so the recommendation logic can
-- surface longer assignments earlier than short ones with similar due dates.
--
-- HOW TO INSTALL:
--   1. Open the Supabase dashboard for this project
--   2. SQL Editor → New query
--   3. Paste this entire file
--   4. Click Run
--
-- HOW TO REMOVE (if you ever need to roll back):
--   alter table public.assignments drop column if exists complexity;

alter table public.assignments
  add column if not exists complexity text not null default 'medium';

-- Constrain to the three valid app values. Dropped first so this file is
-- safe to re-run (idempotent).
alter table public.assignments
  drop constraint if exists assignments_complexity_check;

alter table public.assignments
  add constraint assignments_complexity_check
  check (complexity in ('short', 'medium', 'long'));
