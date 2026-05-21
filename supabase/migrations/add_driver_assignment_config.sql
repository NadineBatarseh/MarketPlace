ALTER TABLE batch_config
  ADD COLUMN IF NOT EXISTS drivers_per_round          integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS max_assignment_rounds      integer DEFAULT 3,
  ADD COLUMN IF NOT EXISTS assignment_timeout_seconds integer DEFAULT 300;
