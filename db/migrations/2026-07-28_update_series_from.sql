-- F3b ("edit this and all future occurrences"): one atomic UPDATE over the
-- tail of a recurring series. The client cannot express the per-row date
-- arithmetic (due_date + delta) through PostgREST, and issuing up to 52
-- individual updates would be slow and non-atomic — a mid-flight failure
-- would leave a series half-shifted. Mirrors dbDeleteSeries's precedent of
-- one server-side statement per series-wide operation.
--
-- SECURITY INVOKER: runs as the calling user, so the existing
-- "Users manage own assignments" RLS policy (auth.uid() = user_id) applies
-- to every row the UPDATE touches — a forged series_id belonging to another
-- user matches zero visible rows.
--
-- `status` applies ONLY to the edited row (p_target_id): the user was
-- looking at that occurrence's status picker when they saved, so discarding
-- it would silently revert a visible edit — but the rest of the tail keeps
-- its own completion state (a completed week stays completed when the
-- series moves). due_time IS always applied to every row (null = "no
-- time"), matching the form, which always submits the full base field set.
--
-- HOW TO INSTALL:
--   1. Open the Supabase dashboard for this project
--   2. SQL Editor → New query
--   3. Paste this entire file
--   4. Click Run
--   5. Verify under Database → Functions that `update_series_from` appears
--
-- HOW TO REMOVE (rollback):
--   drop function if exists public.update_series_from(text, date, integer, text, text, integer, text, text, uuid, text);

create or replace function public.update_series_from(
  p_series_id text,
  p_from_date date,
  p_day_delta integer,
  p_title text,
  p_class_name text,
  p_importance integer,
  p_complexity text,
  p_due_time text,
  p_target_id uuid,
  p_status text
)
returns setof public.assignments
language sql
security invoker
set search_path = ''
as $$
  update public.assignments
     set title      = p_title,
         class_name = p_class_name,
         importance = p_importance,
         complexity = p_complexity,
         due_time   = p_due_time,
         status     = case when id = p_target_id then p_status else status end,
         due_date   = due_date + p_day_delta
   -- user_id = auth.uid() is redundant with RLS under SECURITY INVOKER, but
   -- every other write helper carries the explicit user filter as a second
   -- layer (dbUpdate/dbDelete/dbDeleteSeries), and this function is the
   -- highest-leverage write primitive in the schema — it must not be the
   -- one place that layer is missing if RLS is ever misconfigured.
   where series_id = p_series_id
     and user_id   = auth.uid()
     and due_date >= p_from_date
  returning *;
$$;
