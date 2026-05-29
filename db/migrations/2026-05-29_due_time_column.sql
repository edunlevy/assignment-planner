-- Add optional due_time column (HH:MM, 24-hour) to assignments.
-- NULL means no specific time was set.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS due_time TEXT;

-- Enforce HH:MM format at the DB layer so clients that bypass the app
-- (old versions, direct Supabase API calls, manual edits) cannot persist
-- values that would corrupt display or reminder scheduling.
-- Safe to re-run: Postgres raises an error if the constraint already exists,
-- so wrap in a DO block when applying to a DB where the column was already added.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'assignments_due_time_format'
  ) THEN
    ALTER TABLE assignments ADD CONSTRAINT assignments_due_time_format
      CHECK (due_time IS NULL OR due_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');
  END IF;
END $$;
