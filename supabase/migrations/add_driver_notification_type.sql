ALTER TABLE driver_notifications
  ADD COLUMN IF NOT EXISTS type    varchar NOT NULL DEFAULT 'assignment',
  ADD COLUMN IF NOT EXISTS metadata jsonb   NOT NULL DEFAULT '{}';
