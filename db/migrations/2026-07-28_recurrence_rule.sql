-- Adds the recurrence_rule column: the rule object that generated a
-- recurring series' rows (see lib/recurring.js for the shape), stored
-- verbatim on every row of the series. Standalone assignments and series
-- created before this migration keep null — the app treats null as "no
-- stored rule" everywhere.
--
-- Idempotent: safe to run more than once.
--
-- Rollback:
--   alter table public.assignments drop column if exists recurrence_rule;

alter table public.assignments
  add column if not exists recurrence_rule jsonb;

-- Shape/size guard, matching this repo's convention that every column
-- defends itself at the DB layer against clients that bypass the app (old
-- versions, direct Supabase API calls, manual edits): a rule must be a
-- reasonably small json object. Deliberately structural rather than a full
-- schema check — the rule shape will evolve (F3b), and the app validates
-- semantics; this only blocks arbitrary-type / arbitrary-size abuse.
alter table public.assignments
  drop constraint if exists assignments_recurrence_rule_shape;
alter table public.assignments
  add constraint assignments_recurrence_rule_shape
  check (
    recurrence_rule is null
    or (
      jsonb_typeof(recurrence_rule) = 'object'
      and pg_column_size(recurrence_rule) < 1024
    )
  );

comment on column public.assignments.recurrence_rule is
  'Recurrence rule that generated this series row (freq/interval/byWeekday/end); null for standalone assignments and pre-migration series.';
