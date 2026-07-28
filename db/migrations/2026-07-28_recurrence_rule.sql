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

comment on column public.assignments.recurrence_rule is
  'Recurrence rule that generated this series row (freq/interval/byWeekday/end); null for standalone assignments and pre-migration series.';
