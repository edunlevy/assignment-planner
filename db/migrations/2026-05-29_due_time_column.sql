-- Add optional due_time column (HH:MM, 24-hour) to assignments.
-- NULL means no specific time was set.
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS due_time TEXT;
